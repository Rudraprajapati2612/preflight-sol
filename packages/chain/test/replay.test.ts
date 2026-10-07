import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  decodePoolConfig,
  decodeSwapsFromTransaction,
  orderOfExecution,
  replayLaunch,
} from '../src/index.js'

/**
 * A real launch, replayed.
 *
 * Eight swaps executed on Solana mainnet in eighty-four seconds by people who
 * had never heard of this project, ending in a partial fill that graduated the
 * curve. The program recorded its own answer for each one, so this compares the
 * engine against trades nobody chose for being convenient.
 *
 * Captured once and committed, so the suite stays offline and does not depend
 * on a stranger's pool continuing to exist.
 */

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../core/fixtures/mainnet')

const history = JSON.parse(readFileSync(join(dir, 'launch-history.json'), 'utf8')) as {
  pool: string
  transactions: unknown[]
}
const accounts = JSON.parse(readFileSync(join(dir, 'live-pool.json'), 'utf8')) as {
  config: { data: string }
}

const config = decodePoolConfig(Buffer.from(accounts.config.data, 'base64'))
const swaps = history.transactions
  .flatMap((transaction) => decodeSwapsFromTransaction(transaction as never))
  .sort(orderOfExecution)

describe('replaying a launch from mainnet', () => {
  it('finds the swaps the chain recorded', () => {
    // The swap handler is annotated #[event_cpi], so these live in inner
    // instructions and never appear in the logs. A log-scraping reader finds
    // nothing here and reports a silent success.
    expect(swaps.length).toBeGreaterThanOrEqual(8)
    expect(swaps.every((swap) => swap.result.outputAmount > 0n)).toBe(true)
    expect(swaps.every((swap) => swap.signature.length > 40)).toBe(true)
  })

  it('reads them in the order they happened', () => {
    for (let i = 1; i < swaps.length; i++) {
      const previous = swaps[i - 1]!
      const current = swaps[i]!
      expect(current.slot).toBeGreaterThanOrEqual(previous.slot)
      if (current.slot === previous.slot) {
        expect(current.transactionIndex).toBeGreaterThan(previous.transactionIndex)
      }

      // The reserve rises on a buy and falls on a sell, and each swap's figure
      // follows from the one before it. This is what catches a mis-ordering:
      // two trades sequenced wrongly break the chain here.
      const delta = current.quoteReserveAmount - previous.quoteReserveAmount
      if (current.tradeDirection === 1) {
        expect(delta).toBe(current.result.excludedFeeInputAmount)
      } else {
        expect(delta).toBeLessThan(0n)
      }
    }
  })

  it('contains a sell, not only buys', () => {
    // Worth asserting: a launch of nothing but buys would never exercise the
    // reverse curve traversal, and the replay would look healthier than it is.
    expect(swaps.some((swap) => swap.tradeDirection === 0)).toBe(true)
  })

  it('orders trades that share a slot by their position in it', () => {
    // Two of these transactions landed in one slot. Ordering by slot alone
    // sequences them arbitrarily, and every swap after that prices wrongly.
    const shared = new Map<number, number>()
    for (const swap of swaps) shared.set(swap.slot, (shared.get(swap.slot) ?? 0) + 1)
    expect([...shared.values()].some((count) => count > 1)).toBe(true)
  })

  it('ends in a partial fill that graduated the curve', () => {
    const last = swaps.at(-1)!
    expect(last.result.amountLeft).toBeGreaterThan(0n)
    expect(last.quoteReserveAmount).toBeGreaterThanOrEqual(config.migrationQuoteThreshold)
    expect(last.result.nextSqrtPrice).toBe(config.migrationSqrtPrice)
  })

  it('reproduces every recorded field exactly', () => {
    const report = replayLaunch(history.pool, config, swaps)

    // Printed rather than only asserted, so a failure says which field of
    // which trade disagreed instead of only that something did.
    if (!report.exact) {
      for (const divergence of report.divergences.slice(0, 8)) {
        // eslint-disable-next-line no-console
        console.error(
          `step ${divergence.step} ${divergence.field}: expected ${divergence.expected}, got ${divergence.actual} (${divergence.signature})`,
        )
      }
    }

    expect(report.divergences).toEqual([])
    expect(report.exact).toBe(true)
    expect(report.swapsReplayed).toBe(swaps.length)
    expect(report.fieldsCompared).toBe(swaps.length * 9)
    expect(report.unsupported).toEqual([])
  })

  it('finishes where the chain finished', () => {
    const report = replayLaunch(history.pool, config, swaps)
    expect(report.finalState.quoteReserve).toBe(swaps.at(-1)!.quoteReserveAmount)
    expect(report.finalState.sqrtPrice).toBe(config.migrationSqrtPrice)
  })
})
