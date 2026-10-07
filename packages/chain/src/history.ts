import { createDbcProgram } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { type Connection, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'

import { DBC_PROGRAM_ID } from './fetch.js'

/**
 * Reading what actually happened to a pool.
 *
 * The program's swap handler is annotated `#[event_cpi]`, so its events are
 * emitted as a self-CPI and never appear in the log stream. They have to be
 * read out of inner instructions, which is also why a log-scraping approach to
 * DBC history quietly returns nothing.
 *
 * `EvtSwap2` carries the entire result the program computed — the next square
 * root price, every fee component, the amount left unconsumed. That is what
 * makes historical replay a correctness test rather than a demo: the recorded
 * answer is right there to be compared against.
 */

const ANCHOR_EVENT_CPI_DISCRIMINATOR = 'e445a52e51cb9a1d'

/** `SwapMode` in the program. */
export const SwapMode = {
  ExactIn: 0,
  PartialFill: 1,
  ExactOut: 2,
} as const

/** One swap, as the chain recorded it. */
export interface RecordedSwap {
  /**
   * The pool this swap happened on.
   *
   * One transaction can route through several pools, and every one of them
   * emits its own event. Without this, replaying a pool would pick up
   * strangers' trades and inflate its reserve.
   */
  readonly pool: string
  readonly signature: string
  readonly slot: number
  /**
   * Position within the slot. A slot routinely carries more than one
   * transaction, so a slot number alone does not order two trades — and two
   * trades in the wrong order replay into different prices.
   */
  readonly transactionIndex: number
  readonly blockTime: number
  readonly tradeDirection: number
  /**
   * The first parameter of the swap, whose meaning depends on `swapMode`.
   *
   * Under ExactIn and PartialFill it is the amount offered. Under ExactOut it
   * is the amount demanded, and the input is whatever the curve required to
   * produce it — so reading it as an input silently prices a different trade.
   */
  readonly amount0: bigint
  readonly swapMode: number
  readonly result: {
    readonly includedFeeInputAmount: bigint
    readonly excludedFeeInputAmount: bigint
    readonly amountLeft: bigint
    readonly outputAmount: bigint
    readonly nextSqrtPrice: bigint
    readonly tradingFee: bigint
    readonly protocolFee: bigint
    readonly referralFee: bigint
  }
  readonly quoteReserveAmount: bigint
  readonly currentTimestamp: bigint
}

function eventCoder() {
  const stub = { commitment: 'confirmed', rpcEndpoint: 'offline://' } as unknown as Connection
  return createDbcProgram(stub, 'confirmed').program.coder.events
}

const big = (value: unknown): bigint => BigInt(String(value))

/**
 * Pull the swap events out of one fetched transaction.
 *
 * Exported separately from fetching so the decoding can be tested against real
 * transactions captured once, without a network.
 */
export function decodeSwapsFromTransaction(
  transaction: {
    slot: number
    transactionIndex?: number | null
    blockTime?: number | null
    transaction: { signatures: string[]; message: { accountKeys: string[] } }
    meta: {
      innerInstructions?: { instructions: { programIdIndex: number; data: string }[] }[] | null
      loadedAddresses?: { writable: string[]; readonly: string[] } | null
    } | null
  },
  /** When given, only swaps on this pool are returned. */
  pool?: string,
): RecordedSwap[] {
  const meta = transaction.meta
  if (!meta) return []

  // Version 0 transactions resolve some accounts through lookup tables, and
  // those are appended after the static keys.
  const keys = [
    ...transaction.transaction.message.accountKeys,
    ...(meta.loadedAddresses?.writable ?? []),
    ...(meta.loadedAddresses?.readonly ?? []),
  ]

  const coder = eventCoder()
  const swaps: RecordedSwap[] = []

  for (const group of meta.innerInstructions ?? []) {
    for (const instruction of group.instructions) {
      if (keys[instruction.programIdIndex] !== DBC_PROGRAM_ID) continue

      const data = Buffer.from(bs58.decode(instruction.data))
      if (data.length < 16) continue
      if (data.subarray(0, 8).toString('hex') !== ANCHOR_EVENT_CPI_DISCRIMINATOR) continue

      const event = coder.decode(data.subarray(8).toString('base64'))
      // Only the richer event is taken. A swap emits both shapes, and counting
      // each one would double every trade.
      if (!event || event.name !== 'evtSwap2') continue

      const payload = event.data as Record<string, Record<string, unknown> & unknown>
      const result = payload['swapResult'] as Record<string, unknown>
      const parameters = payload['swapParameters'] as Record<string, unknown>

      swaps.push({
        pool: String(payload['pool']),
        signature: transaction.transaction.signatures[0] ?? '',
        slot: transaction.slot,
        transactionIndex: transaction.transactionIndex ?? 0,
        blockTime: transaction.blockTime ?? 0,
        tradeDirection: Number(payload['tradeDirection']),
        amount0: big(parameters['amount0']),
        swapMode: Number(parameters['swapMode']),
        result: {
          includedFeeInputAmount: big(result['includedFeeInputAmount']),
          excludedFeeInputAmount: big(result['excludedFeeInputAmount']),
          amountLeft: big(result['amountLeft']),
          outputAmount: big(result['outputAmount']),
          nextSqrtPrice: big(result['nextSqrtPrice']),
          tradingFee: big(result['tradingFee']),
          protocolFee: big(result['protocolFee']),
          referralFee: big(result['referralFee']),
        },
        quoteReserveAmount: big(payload['quoteReserveAmount']),
        currentTimestamp: big(payload['currentTimestamp']),
      })
    }
  }

  return pool === undefined ? swaps : swaps.filter((swap) => swap.pool === pool)
}

/**
 * Every swap a pool has seen, oldest first.
 *
 * The chain returns signatures newest first; replay needs them in the order
 * they happened, because each swap's result depends on the state the one
 * before it left behind.
 */
export async function fetchSwapHistory(
  connection: Connection,
  poolAddress: string,
  options: {
    limit?: number
    /** Transactions fetched in parallel. */
    concurrency?: number
    onProgress?: (done: number, total: number) => void
  } = {},
): Promise<RecordedSwap[]> {
  const signatures = await connection.getSignaturesForAddress(new PublicKey(poolAddress), {
    limit: options.limit ?? 1000,
  })

  // The endpoint returns signatures newest first, and that ordering is
  // authoritative. Reversed, it is the order the chain executed them — which
  // matters because web3.js does not surface a transaction's position within
  // its slot, and a slot routinely carries more than one.
  const successful = signatures
    .filter((entry) => !entry.err)
    .map((entry) => entry.signature)
    .reverse()
  const swaps: RecordedSwap[] = []

  // Fetched a batch at a time. One at a time is simpler but a busy pool has
  // hundreds of transactions, and serial round trips turn a replay into
  // something nobody waits for.
  const batchSize = options.concurrency ?? 16
  for (let offset = 0; offset < successful.length; offset += batchSize) {
    const batch = successful.slice(offset, offset + batchSize)
    const fetched = await Promise.all(
      batch.map(async (signature) => {
        const transaction = await connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        })
        return transaction ? toWireShape(signature, transaction) : null
      }),
    )
    for (const [index, transaction] of fetched.entries()) {
      if (!transaction) continue
      // Position in the endpoint's own ordering, which stands in for the
      // position within a slot that web3.js does not report.
      const order = offset + index
      swaps.push(
        ...decodeSwapsFromTransaction({ ...transaction, transactionIndex: order }, poolAddress),
      )
    }
    options.onProgress?.(Math.min(offset + batchSize, successful.length), successful.length)
  }

  // Already in execution order: the endpoint's sequence was reversed and each
  // transaction numbered by it. Re-sorting on slot alone would undo that.
  return swaps
}

/**
 * Present a web3.js transaction the way the JSON-RPC wire format does.
 *
 * The decoder works on the wire shape on purpose: that is what a captured
 * recording contains, so the same code path is exercised whether a launch is
 * being read live or replayed from a file. web3.js hands back `PublicKey`
 * objects and a versioned message instead, so it is adapted here rather than
 * teaching the decoder two dialects.
 */
function toWireShape(
  signature: string,
  transaction: {
    slot: number
    blockTime?: number | null
    transaction: { message: unknown; signatures: string[] }
    meta: unknown
  },
): Parameters<typeof decodeSwapsFromTransaction>[0] {
  const message = transaction.transaction.message as {
    staticAccountKeys?: { toBase58(): string }[]
    accountKeys?: { toBase58(): string }[] | string[]
  }
  const keys = (message.staticAccountKeys ?? message.accountKeys ?? []) as (
    { toBase58(): string } | string
  )[]

  const meta = transaction.meta as {
    innerInstructions?: { instructions: { programIdIndex: number; data: string }[] }[] | null
    loadedAddresses?: { writable: unknown[]; readonly: unknown[] } | null
  } | null

  const asBase58 = (value: unknown): string =>
    typeof value === 'string' ? value : String((value as { toBase58(): string }).toBase58())

  return {
    slot: transaction.slot,
    // Filled in by the caller from the endpoint's ordering; web3.js does not
    // report a transaction's position within its slot.
    transactionIndex: 0,
    blockTime: transaction.blockTime ?? 0,
    transaction: {
      signatures: [signature],
      message: { accountKeys: keys.map(asBase58) },
    },
    meta: meta
      ? {
          innerInstructions: meta.innerInstructions ?? null,
          loadedAddresses: meta.loadedAddresses
            ? {
                writable: meta.loadedAddresses.writable.map(asBase58),
                readonly: meta.loadedAddresses.readonly.map(asBase58),
              }
            : null,
        }
      : null,
  }
}

/**
 * The order the chain executed these in.
 *
 * Slot first, then position within the slot. Leaving out the second term looks
 * harmless until two trades land in one slot, at which point the replay prices
 * them in whichever order they happened to arrive in and every subsequent swap
 * is wrong.
 */
export function orderOfExecution(a: RecordedSwap, b: RecordedSwap): number {
  return a.slot === b.slot ? a.transactionIndex - b.transactionIndex : a.slot - b.slot
}
