import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Connection, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { describe, expect, it } from 'vitest'

import { fetchSwapHistory, orderOfExecution, type RecordedSwap } from '../src/index.js'

/**
 * The fetch path, exercised offline.
 *
 * A stub endpoint serves the transactions captured from mainnet in the shape
 * web3.js hands back — `PublicKey` objects and a versioned message — so the
 * adaptation between that and the wire format the decoder reads is covered
 * without a network.
 */

const history = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../core/fixtures/mainnet/launch-history.json',
    ),
    'utf8',
  ),
) as {
  pool: string
  transactions: {
    slot: number
    blockTime: number
    transaction: { signatures: string[]; message: { accountKeys: string[] } }
    meta: {
      innerInstructions: { instructions: { programIdIndex: number; data: string }[] }[] | null
      loadedAddresses: { writable: string[]; readonly: string[] } | null
    }
  }[]
}

/** Captured transactions, dressed the way web3.js returns them. */
function stubConnection(): Connection {
  const bySignature = new Map(
    history.transactions.map((transaction) => [
      transaction.transaction.signatures[0]!,
      {
        slot: transaction.slot,
        blockTime: transaction.blockTime,
        transaction: {
          signatures: transaction.transaction.signatures,
          message: {
            staticAccountKeys: transaction.transaction.message.accountKeys.map(
              (key) => new PublicKey(key),
            ),
          },
        },
        meta: {
          innerInstructions: transaction.meta.innerInstructions,
          loadedAddresses: transaction.meta.loadedAddresses
            ? {
                writable: transaction.meta.loadedAddresses.writable.map((k) => new PublicKey(k)),
                readonly: transaction.meta.loadedAddresses.readonly.map((k) => new PublicKey(k)),
              }
            : null,
        },
      },
    ]),
  )

  // The captured transactions are already newest first, which is how the
  // endpoint returns them — fetchSwapHistory does the reversing. The oldest is
  // marked failed, to check a reverted transaction is not replayed as though
  // it had happened.
  const keys = [...bySignature.keys()]
  const signatures = keys.map((signature, index) => ({
    signature,
    err: index === keys.length - 1 ? ({} as never) : null,
  }))

  return {
    getSignaturesForAddress: () => Promise.resolve(signatures),
    getTransaction: (signature: string) => Promise.resolve(bySignature.get(signature) ?? null),
  } as unknown as Connection
}

describe('fetchSwapHistory', () => {
  it('reads a launch back in the order it was executed', async () => {
    const swaps = await fetchSwapHistory(stubConnection(), history.pool)

    expect(swaps.length).toBeGreaterThan(0)
    // Each swap's quote reserve follows from the one before it, which only
    // holds if they are in the right order.
    for (let i = 1; i < swaps.length; i++) {
      const previous = swaps[i - 1]!
      const current = swaps[i]!
      if (current.tradeDirection === 1) {
        expect(current.quoteReserveAmount - previous.quoteReserveAmount).toBe(
          current.result.excludedFeeInputAmount,
        )
      }
    }
  })

  it('leaves out transactions that failed', async () => {
    const swaps = await fetchSwapHistory(stubConnection(), history.pool)
    // The stub marks the oldest transaction failed; a reverted transaction
    // changed nothing on chain and must not be replayed as though it did.
    expect(swaps.length).toBeLessThan(history.transactions.length)
  })

  it('reports progress while it works', async () => {
    const seen: [number, number][] = []
    await fetchSwapHistory(stubConnection(), history.pool, {
      concurrency: 4,
      onProgress: (done, total) => seen.push([done, total]),
    })
    expect(seen.length).toBeGreaterThan(1)
    expect(seen.at(-1)![0]).toBe(seen.at(-1)![1])
  })

  it('ignores swaps belonging to some other pool', async () => {
    // One transaction can route through several pools, each emitting its own
    // event. Counting a stranger's trade inflates this pool's reserve.
    const swaps = await fetchSwapHistory(stubConnection(), '11111111111111111111111111111112')
    expect(swaps).toEqual([])
  })
})

describe('orderOfExecution', () => {
  const at = (slot: number, transactionIndex: number): RecordedSwap =>
    ({ slot, transactionIndex }) as RecordedSwap

  it('orders by slot first', () => {
    expect(orderOfExecution(at(1, 900), at(2, 0))).toBeLessThan(0)
  })

  it('breaks a tie on position within the slot', () => {
    // Without this, two trades in one slot sequence arbitrarily and every swap
    // after them prices wrongly.
    expect(orderOfExecution(at(5, 50), at(5, 802))).toBeLessThan(0)
    expect(orderOfExecution(at(5, 802), at(5, 50))).toBeGreaterThan(0)
  })

  it('leaves genuinely identical positions alone', () => {
    expect(orderOfExecution(at(5, 7), at(5, 7))).toBe(0)
  })
})

describe('event decoding', () => {
  it('reads events from inner instructions, not from logs', () => {
    // The swap handler is annotated #[event_cpi], so nothing appears in the
    // log stream. A log-scraping reader finds nothing and reports success.
    const isEvent = (data: string): boolean => {
      if (!data) return false
      try {
        return Buffer.from(bs58.decode(data)).subarray(0, 8).toString('hex') === 'e445a52e51cb9a1d'
      } catch {
        return false
      }
    }
    const withEvents = history.transactions.filter((transaction) =>
      (transaction.meta.innerInstructions ?? []).some((group) =>
        group.instructions.some((instruction) => isEvent(instruction.data)),
      ),
    )
    expect(withEvents.length).toBeGreaterThan(0)
  })
})
