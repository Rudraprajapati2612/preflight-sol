import { baselineConfig, deriveLaunchMetrics, SOL } from '@preflight/config'
import { describe, expect, it } from 'vitest'

import { DbcOracle } from '../../src/oracle/harness.js'

/**
 * Derived figures, checked against the figures the program itself computed.
 *
 * `migrationSqrtPrice` and the base tokens seeded at graduation are not in the
 * configuration a launcher writes — the program works them out and stores them
 * on the config account. So the read-outs shown before a launch can be compared
 * against what the chain will actually do, rather than merely being internally
 * consistent.
 */
describe('derived launch metrics agree with the program', () => {
  it('derives the same migration price the program stores', async () => {
    const oracle = await DbcOracle.create({ seed: 'derive/agreement' })
    const params = oracle.configFor()
    const config = await oracle.createConfig(params)

    const metrics = deriveLaunchMetrics(params, SOL)
    const stored = (await oracle.configState(config)) as {
      migrationSqrtPrice: { toString(): string }
      migrationBaseThreshold: { toString(): string }
      migrationQuoteThreshold: { toString(): string }
    }

    expect(metrics.migrationSqrtPrice).toBe(BigInt(stored.migrationSqrtPrice.toString()))
  })

  it('derives the same base amount the program will seed the pool with', async () => {
    const oracle = await DbcOracle.create({ seed: 'derive/base-amount' })
    const params = oracle.configFor()
    const config = await oracle.createConfig(params)

    const metrics = deriveLaunchMetrics(params, SOL)
    const stored = (await oracle.configState(config)) as {
      migrationBaseThreshold: { toString(): string }
    }

    const storedWhole = Number(BigInt(stored.migrationBaseThreshold.toString())) / 1e6
    expect(metrics.migrationBaseTokens).toBeCloseTo(storedWhole, 6)
  })

  it('reports figures a launcher can act on', () => {
    const metrics = deriveLaunchMetrics(baselineConfig(), SOL)

    // The curve must go up, or there is nothing to graduate towards.
    expect(metrics.migrationPrice).toBeGreaterThan(metrics.initialPrice)
    expect(metrics.priceMultiple).toBeGreaterThan(1)
    expect(metrics.migrationMarketCap).toBeGreaterThan(metrics.initialMarketCap)

    // The preset asks for 20% of supply to migrate; the program adjusts that
    // slightly, so this checks the shape rather than an exact figure.
    expect(metrics.percentageSupplyOnMigration).toBeGreaterThan(10)
    expect(metrics.percentageSupplyOnMigration).toBeLessThan(40)

    expect(metrics.startingFeePercent).toBeCloseTo(1, 6)
    expect(metrics.quoteSymbol).toBe('SOL')
    expect(metrics.migrationQuoteThreshold).toBeCloseTo(50, 6)
  })
})
