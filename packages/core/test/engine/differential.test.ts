import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { decodeConfig, decodePoolState, decodeSwapResult } from '../../src/engine/decode.js'
import { VirtualPool } from '../../src/engine/pool.js'
import { TradeDirection } from '../../src/engine/types.js'
import type { OracleFixture } from '../../src/oracle/fixtures.js'

/**
 * The engine, replayed against what the real program actually did.
 *
 * This is the test the whole project rests on. The fixture was produced by
 * executing Meteora's deployed bytecode, so every expectation here is a
 * recording rather than a guess, and every field is compared exactly — no
 * tolerances, no rounding, no "close enough". A simulator that is approximately
 * right about fees and prices is not useful for deciding how to launch a token.
 */

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/oracle')
const load = (name: string): OracleFixture =>
  JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), 'utf8')) as OracleFixture

/**
 * `baseline` isolates curve and fee-schedule mechanics. `dynamic-fee` adds the
 * volatility-driven fee, with trade gaps that cross the filter and decay
 * periods, so the tracker's state machine is exercised rather than sitting at
 * zero.
 */
const FIXTURES = ['baseline', 'dynamic-fee', 'output-fee', 'exact-out', 'fee-decay'] as const

/** The field-by-field comparison, named so failures say which number is wrong. */
const SWAP_RESULT_FIELDS = [
  'includedFeeInputAmount',
  'excludedFeeInputAmount',
  'amountLeft',
  'outputAmount',
  'nextSqrtPrice',
  'tradingFee',
  'protocolFee',
  'referralFee',
] as const

const VOLATILITY_FIELDS = [
  'lastUpdateTimestamp',
  'sqrtPriceReference',
  'volatilityAccumulator',
  'volatilityReference',
] as const

const POOL_FIELDS = [
  'sqrtPrice',
  'baseReserve',
  'quoteReserve',
  'protocolBaseFee',
  'protocolQuoteFee',
  'partnerBaseFee',
  'partnerQuoteFee',
  'creatorBaseFee',
  'creatorQuoteFee',
] as const

describe.each(FIXTURES)('engine vs deployed program: %s', (name) => {
  const fixture = load(name)

  it('replays every recorded swap bit-exactly', () => {
    const config = decodeConfig(fixture.configAccount)
    const pool = new VirtualPool(config, decodePoolState(fixture.initialPoolState))

    expect(fixture.swaps.length).toBeGreaterThan(0)

    for (const swap of fixture.swaps) {
      const expected = decodeSwapResult((swap.event as { swapResult: unknown }).swapResult)
      const expectedState = decodePoolState(swap.poolStateAfter)

      const clock = {
        slot: BigInt(swap.clock.slot),
        unixTimestamp: BigInt(swap.clock.unixTimestamp),
      }
      // The recorded amount is an input for exact-in and partial fills and an
      // output for exact-out. Passing it in the wrong role prices a different
      // trade, which is exactly the mistake a live replay caught.
      const { result, stateAfter } = pool.swap(BigInt(swap.amountIn), TradeDirection.QuoteToBase, {
        // Derived from the config rather than hardcoded, so the recording also
        // checks that the right clock is being read.
        currentPoint: VirtualPool.currentPoint(config, clock),
        currentTimestamp: clock.unixTimestamp,
        mode: swap.kind,
      })

      for (const field of SWAP_RESULT_FIELDS) {
        expect(result[field], `swap ${swap.step} (${swap.kind}): ${field}`).toBe(expected[field])
      }
      for (const field of POOL_FIELDS) {
        expect(stateAfter[field], `swap ${swap.step} (${swap.kind}): pool.${field}`).toBe(
          expectedState[field],
        )
      }
      // The volatility tracker drives the dynamic fee, so its own state has to
      // match too — a tracker that drifts would charge the wrong fee later.
      for (const field of VOLATILITY_FIELDS) {
        expect(
          stateAfter.volatilityTracker[field],
          `swap ${swap.step} (${swap.kind}): volatilityTracker.${field}`,
        ).toBe(expectedState.volatilityTracker[field])
      }
    }
  })

  it('agrees with the program about when the curve has completed', () => {
    const config = decodeConfig(fixture.configAccount)
    const pool = new VirtualPool(config, decodePoolState(fixture.initialPoolState))

    for (const swap of fixture.swaps) {
      expect(pool.isCurveComplete, `before swap ${swap.step}`).toBe(false)
      pool.swap(BigInt(swap.amountIn), TradeDirection.QuoteToBase, {
        currentPoint: VirtualPool.currentPoint(config, {
          slot: BigInt(swap.clock.slot),
          unixTimestamp: BigInt(swap.clock.unixTimestamp),
        }),
        currentTimestamp: BigInt(swap.clock.unixTimestamp),
        mode: swap.kind,
      })
    }

    // Most recordings end with a partial fill that takes the pool over the
    // line; the exact-out one ends mid-curve on purpose.
    if (fixture.swaps.at(-1)?.kind === 'partialFill') {
      expect(pool.isCurveComplete).toBe(true)
      expect(pool.state.quoteReserve).toBeGreaterThanOrEqual(config.migrationQuoteThreshold)
    }
  })
})
