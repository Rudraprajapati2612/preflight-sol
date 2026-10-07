import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { decodeConfig, decodePoolState } from '../../src/engine/decode.js'
import { VirtualPool } from '../../src/engine/pool.js'
import type { OracleFixture } from '../../src/oracle/fixtures.js'

/**
 * Properties that must hold for any sequence of trades, not just the recorded
 * ones.
 *
 * The differential tests prove the engine matches the program on the paths a
 * recording happens to walk. These explore the space around those paths: a
 * launch is driven by whoever shows up, and an engine that is only correct for
 * the trade sizes someone thought to record is not much use for deciding how to
 * configure a curve.
 */

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/oracle/baseline.json'),
    'utf8',
  ),
) as OracleFixture

const config = decodeConfig(fixture.configAccount)
const initialState = decodePoolState(fixture.initialPoolState)

const freshPool = (): VirtualPool => new VirtualPool(config, initialState)

/** Trade sizes spanning dust through far more than the curve can absorb. */
const amountIn = fc.bigInt({ min: 1n, max: 200n * 1_000_000_000n })
/** Seconds between trades, crossing the filter and decay periods. */
const gap = fc.bigInt({ min: 0n, max: 400n })

const clockAt = (timestamp: bigint) => ({
  currentPoint: timestamp,
  currentTimestamp: timestamp,
  partialFill: true,
})

describe('engine properties', () => {
  it('a buy never lowers the price, and never passes the migration price', () => {
    fc.assert(
      fc.property(fc.array(amountIn, { minLength: 1, maxLength: 12 }), (amounts) => {
        const pool = freshPool()
        let timestamp = 1_767_225_600n
        let previous = pool.state.sqrtPrice

        for (const amount of amounts) {
          timestamp += 31n
          const { stateAfter } = pool.buy(amount, clockAt(timestamp))
          expect(stateAfter.sqrtPrice).toBeGreaterThanOrEqual(previous)
          // Partial fill must stop the curve at its migration price, never past.
          expect(stateAfter.sqrtPrice).toBeLessThanOrEqual(config.migrationSqrtPrice)
          previous = stateAfter.sqrtPrice
        }
      }),
      { numRuns: 60 },
    )
  })

  it('every input is fully accounted for as reserve plus fees', () => {
    fc.assert(
      fc.property(amountIn, gap, (amount, seconds) => {
        const pool = freshPool()
        const { result } = pool.buy(amount, clockAt(1_767_225_600n + seconds))

        // Fees are taken on the input in quote-token mode, so the gross input
        // splits exactly into the part that reached the curve and the fees.
        expect(
          result.excludedFeeInputAmount +
            result.tradingFee +
            result.protocolFee +
            result.referralFee,
        ).toBe(result.includedFeeInputAmount)

        // Nothing is invented: the pool never takes more than was offered.
        expect(result.includedFeeInputAmount).toBeLessThanOrEqual(amount)
        expect(result.includedFeeInputAmount + result.amountLeft).toBeLessThanOrEqual(amount)
      }),
      { numRuns: 200 },
    )
  })

  it('the quote reserve grows by exactly what reached the curve', () => {
    fc.assert(
      fc.property(fc.array(amountIn, { minLength: 1, maxLength: 8 }), (amounts) => {
        const pool = freshPool()
        let timestamp = 1_767_225_600n
        let expectedReserve = pool.state.quoteReserve

        for (const amount of amounts) {
          timestamp += 31n
          const { result, stateAfter } = pool.buy(amount, clockAt(timestamp))
          expectedReserve += result.excludedFeeInputAmount
          expect(stateAfter.quoteReserve).toBe(expectedReserve)
        }
      }),
      { numRuns: 60 },
    )
  })

  it('fee buckets accumulate every fee the swaps reported, and nothing else', () => {
    fc.assert(
      fc.property(fc.array(amountIn, { minLength: 1, maxLength: 8 }), (amounts) => {
        const pool = freshPool()
        let timestamp = 1_767_225_600n
        let trading = 0n
        let protocol = 0n

        for (const amount of amounts) {
          timestamp += 31n
          const { result } = pool.buy(amount, clockAt(timestamp))
          trading += result.tradingFee
          protocol += result.protocolFee
        }

        const state = pool.state
        // This config gives the creator no share, so the partner takes it all.
        expect(state.partnerQuoteFee + state.creatorQuoteFee).toBe(trading)
        expect(state.protocolQuoteFee).toBe(protocol)
        // Quote-token fee mode never accrues base-token fees.
        expect(state.partnerBaseFee + state.creatorBaseFee + state.protocolBaseFee).toBe(0n)
      }),
      { numRuns: 60 },
    )
  })

  it('reserves stay non-negative and the base reserve only falls', () => {
    fc.assert(
      fc.property(fc.array(amountIn, { minLength: 1, maxLength: 10 }), (amounts) => {
        const pool = freshPool()
        let timestamp = 1_767_225_600n
        let previousBase = pool.state.baseReserve

        for (const amount of amounts) {
          timestamp += 31n
          const { stateAfter } = pool.buy(amount, clockAt(timestamp))
          expect(stateAfter.baseReserve).toBeGreaterThanOrEqual(0n)
          expect(stateAfter.quoteReserve).toBeGreaterThanOrEqual(0n)
          // Buying takes base out of the pool; it can never put base back.
          expect(stateAfter.baseReserve).toBeLessThanOrEqual(previousBase)
          previousBase = stateAfter.baseReserve
        }
      }),
      { numRuns: 60 },
    )
  })

  it('completion is reached only once the threshold is met, and is permanent', () => {
    fc.assert(
      fc.property(fc.array(amountIn, { minLength: 1, maxLength: 12 }), (amounts) => {
        const pool = freshPool()
        let timestamp = 1_767_225_600n
        let wasComplete = false

        for (const amount of amounts) {
          timestamp += 31n
          pool.buy(amount, clockAt(timestamp))
          const complete = pool.isCurveComplete
          expect(complete).toBe(pool.state.quoteReserve >= config.migrationQuoteThreshold)
          // Buying cannot un-graduate a curve.
          if (wasComplete) expect(complete).toBe(true)
          wasComplete = complete
        }
      }),
      { numRuns: 60 },
    )
  })

  it('a sell moves base in and quote out, exactly', () => {
    fc.assert(
      fc.property(amountIn, (amount) => {
        const pool = freshPool()
        // Buy first, so there is quote in the pool to sell back into.
        pool.buy(30n * 1_000_000_000n, clockAt(1_767_225_600n))
        const before = pool.state

        const baseHeld = initialState.baseReserve - before.baseReserve
        const sellAmount = amount > baseHeld ? baseHeld : amount
        if (sellAmount === 0n) return

        const { result, stateAfter } = pool.sell(sellAmount, {
          currentPoint: 1_767_225_700n,
          currentTimestamp: 1_767_225_700n,
          partialFill: true,
        })

        // Selling walks the curve back down, never up, and never below the start.
        expect(stateAfter.sqrtPrice).toBeLessThanOrEqual(before.sqrtPrice)
        expect(stateAfter.sqrtPrice).toBeGreaterThanOrEqual(config.sqrtStartPrice)

        // Base flows in fee-exclusive.
        expect(stateAfter.baseReserve).toBe(before.baseReserve + result.excludedFeeInputAmount)

        // Selling collects its fee on the output, so the pool releases the gross
        // amount and retains the fee: the reserve falls by more than the trader
        // receives. Getting this backwards is a silent leak of protocol revenue.
        const grossOut =
          result.outputAmount + result.tradingFee + result.protocolFee + result.referralFee
        expect(stateAfter.quoteReserve).toBe(before.quoteReserve - grossOut)

        // A sell in quote-token fee mode still accrues its fee in quote.
        expect(stateAfter.protocolQuoteFee).toBe(before.protocolQuoteFee + result.protocolFee)
        expect(stateAfter.partnerQuoteFee + stateAfter.creatorQuoteFee).toBe(
          before.partnerQuoteFee + before.creatorQuoteFee + result.tradingFee,
        )
      }),
      { numRuns: 80 },
    )
  })
})
