import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { organic, runScenario, sniper, whale } from '@preflight/agents'
import { SOL, USDC } from '@preflight/config'
import { decodeConfig, decodePoolState } from '@preflight/core'
import { type OracleFixture } from '@preflight/core/oracle'
import { describe, expect, it } from 'vitest'

import { buildReport, gini, priceFromSqrtPrice, ratio } from '../src/index.js'

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../core/fixtures/oracle/baseline.json'),
    'utf8',
  ),
) as OracleFixture

const config = decodeConfig(fixture.configAccount)
const initialPool = decodePoolState(fixture.initialPoolState)
const SOL_UNIT = 1_000_000_000n

const trace = runScenario({
  seed: 'metrics',
  config,
  initialPool,
  participants: [
    {
      agent: sniper('sniper-1', { size: 8n * SOL_UNIT, exitMultiple: 1.5 }),
      funding: 40n * SOL_UNIT,
    },
    {
      agent: whale('whale-1', {
        size: 15n * SOL_UNIT,
        minGapSeconds: 20,
        maxGapSeconds: 90,
        patience: 0.35,
      }),
      funding: 120n * SOL_UNIT,
    },
    ...Array.from({ length: 6 }, (_, i) => ({
      agent: organic(`organic-${i}`, {
        minSize: SOL_UNIT / 5n,
        maxSize: 3n * SOL_UNIT,
        sellChance: 0.25,
        activity: 0.4,
      }),
      funding: 25n * SOL_UNIT,
    })),
  ],
  maxSteps: 400,
})

const report = buildReport({ trace, config, baseDecimals: 6, quoteAsset: SOL })

describe('exact arithmetic', () => {
  it('divides amounts that exceed what a float can hold', () => {
    // Both of these are past 2^53; Number(a)/Number(b) would already be lying.
    const a = 9_007_199_254_740_993_000n
    const b = 18_014_398_509_481_986_000n
    expect(ratio(a, b)).toBeCloseTo(0.5, 9)
  })

  it('does not truncate a small price to zero', () => {
    // A launch starts at a price small enough that shifting before multiplying
    // would round it away entirely.
    const price = priceFromSqrtPrice(config.sqrtStartPrice, 6, 9)
    expect(price).toBeGreaterThan(0)
  })

  it('agrees with the price the curve implies', () => {
    const start = priceFromSqrtPrice(config.sqrtStartPrice, 6, 9)
    const end = priceFromSqrtPrice(config.migrationSqrtPrice, 6, 9)
    expect(end).toBeGreaterThan(start)
  })
})

describe('gini', () => {
  it('is zero when everyone holds the same', () => {
    expect(gini([100n, 100n, 100n, 100n])).toBeCloseTo(0, 6)
  })

  it('approaches one when a single holder has everything', () => {
    expect(gini([0n, 0n, 0n, 1_000_000n])).toBeGreaterThan(0.7)
  })

  it('is higher for a more unequal distribution', () => {
    const even = gini([10n, 10n, 10n, 10n, 10n])
    const skewed = gini([1n, 1n, 1n, 1n, 46n])
    expect(skewed).toBeGreaterThan(even)
  })

  it('handles degenerate inputs without dividing by zero', () => {
    expect(gini([])).toBe(0)
    expect(gini([5n])).toBe(0)
    expect(gini([0n, 0n])).toBe(0)
  })
})

describe('a launch report', () => {
  it('reports a graduated launch and how long it took', () => {
    expect(report.graduated).toBe(true)
    expect(report.timeToGraduationSeconds).not.toBeNull()
    expect(report.timeToGraduationSeconds!).toBeGreaterThan(0n)
  })

  it('counts every trade exactly once', () => {
    expect(report.buys + report.sells).toBe(report.trades)
    expect(report.trades).toBe(trace.steps.length)
  })

  it('reports the fees the pool actually retained', () => {
    const pool = trace.finalPool
    expect(report.feesTotal).toBe(
      pool.protocolQuoteFee +
        pool.partnerQuoteFee +
        pool.creatorQuoteFee +
        pool.protocolBaseFee +
        pool.partnerBaseFee +
        pool.creatorBaseFee,
    )
    expect(report.feesTotal).toBeGreaterThan(0n)
  })

  it('reports the quote actually raised, not the quote paid', () => {
    // Volume includes fees; what reached the curve does not. Conflating them
    // would overstate what a launch raised by exactly the fee take.
    expect(report.quoteRaised).toBe(trace.finalPool.quoteReserve)
    expect(report.quoteVolume).toBeGreaterThan(report.quoteRaised)
  })

  it('shows the price rising across the launch', () => {
    expect(report.closingPrice).toBeGreaterThan(report.openingPrice)
    expect(report.peakPrice).toBeGreaterThanOrEqual(report.closingPrice)
    expect(report.priceMultiple).toBeGreaterThan(1)
  })

  it('describes who ended up holding the supply', () => {
    const { concentration: held } = report
    expect(held.holders).toBeGreaterThan(0)
    expect(held.topHolderShare).toBeGreaterThan(0)
    expect(held.topHolderShare).toBeLessThanOrEqual(1)
    expect(held.topFiveShare).toBeGreaterThanOrEqual(held.topHolderShare)
    expect(held.gini).toBeGreaterThanOrEqual(0)
    expect(held.gini).toBeLessThanOrEqual(1)
    // The holdings it measures are the holdings the agents actually have.
    expect(held.totalHeld).toBe(trace.agents.reduce((t, a) => t + a.baseBalance, 0n))
  })

  it('produces candles that cover the launch in order', () => {
    expect(report.candles.length).toBeGreaterThan(0)
    for (let i = 1; i < report.candles.length; i++) {
      expect(report.candles[i]!.timestamp).toBeGreaterThan(report.candles[i - 1]!.timestamp)
    }
    for (const candle of report.candles) {
      expect(candle.high).toBeGreaterThanOrEqual(candle.low)
      expect(candle.high).toBeGreaterThanOrEqual(candle.open)
      expect(candle.high).toBeGreaterThanOrEqual(candle.close)
    }
    // Every trade lands in exactly one bucket.
    const bucketed = report.candles.reduce((total, candle) => total + candle.volume, 0n)
    expect(bucketed).toBe(report.quoteVolume)
  })

  it('reports volatility and slippage as finite numbers', () => {
    expect(Number.isFinite(report.volatility)).toBe(true)
    expect(report.volatility).toBeGreaterThan(0)
    expect(Number.isFinite(report.averageSlippage)).toBe(true)
    expect(report.worstSlippage).toBeGreaterThanOrEqual(report.averageSlippage)
  })

  it('reports slippage as a plausible fraction, not a unit mix-up', () => {
    // The realised price is computed from atomic amounts while the spot price
    // is per whole token. Comparing them without the decimal adjustment gives
    // slippage in the tens of thousands of percent — a number obviously wrong
    // to a reader but perfectly finite, so an is-it-a-number check misses it.
    expect(report.averageSlippage).toBeLessThan(1)
    expect(report.worstSlippage).toBeLessThan(2)
    expect(report.averageSlippage).toBeGreaterThan(0)
  })

  it('measures slippage the same way whatever the token precisions', () => {
    // Nine-decimal base against a six-decimal quote is the reverse adjustment.
    const other = buildReport({ trace, config, baseDecimals: 9, quoteAsset: USDC })
    expect(other.averageSlippage).toBeLessThan(1)
    expect(other.worstSlippage).toBeLessThan(2)
  })

  it('is as reproducible as the trace it came from', () => {
    const again = buildReport({ trace, config, baseDecimals: 6, quoteAsset: SOL })
    expect(JSON.stringify(again, bigintReplacer)).toBe(JSON.stringify(report, bigintReplacer))
  })
})

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

describe('a launch where nothing happened', () => {
  // A curve can be priced so that nobody trades, or a scenario can be given no
  // participants. That is a result worth reporting, not a crash.
  const emptyTrace = runScenario({
    seed: 'nobody',
    config,
    initialPool,
    participants: [],
    maxSteps: 10,
  })

  const emptyReport = buildReport({
    trace: emptyTrace,
    config,
    baseDecimals: 6,
    quoteAsset: SOL,
  })

  it('reports no trades rather than failing', () => {
    expect(emptyReport.trades).toBe(0)
    expect(emptyReport.graduated).toBe(false)
    expect(emptyReport.timeToGraduationSeconds).toBeNull()
    expect(emptyReport.candles).toEqual([])
  })

  it('returns zeroes rather than NaN or Infinity', () => {
    expect(emptyReport.priceMultiple).toBe(0)
    expect(emptyReport.volatility).toBe(0)
    expect(emptyReport.averageSlippage).toBe(0)
    expect(emptyReport.worstSlippage).toBe(0)
    expect(emptyReport.quoteVolume).toBe(0n)
  })

  it('reports nobody holding anything', () => {
    const { concentration: held } = emptyReport
    expect(held.holders).toBe(0)
    expect(held.totalHeld).toBe(0n)
    expect(held.topHolderShare).toBe(0)
    expect(held.gini).toBe(0)
    expect(held.sniperShare).toBe(0)
  })

  it('divides safely by a zero denominator', () => {
    expect(ratio(5n, 0n)).toBe(0)
    expect(priceFromSqrtPrice(0n, 6, 9)).toBe(0)
  })

  it('handles a quote asset with fewer decimals than the base token', () => {
    // The decimal adjustment changes sign, which is a different code path.
    const highDecimalBase = priceFromSqrtPrice(config.sqrtStartPrice, 9, 6)
    expect(Number.isFinite(highDecimalBase)).toBe(true)
    expect(highDecimalBase).toBeGreaterThan(0)
  })
})
