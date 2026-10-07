import BN from 'bn.js'
import { describe, expect, it } from 'vitest'

import { deriveLaunchMetrics } from '../src/derive.js'
import { baselineConfig } from '../src/presets.js'
import { SOL, USDC } from '../src/quote-asset.js'

/**
 * The read-outs are checked against the program in the core package, where the
 * oracle lives. What is checked here is that they stay sane when the inputs are
 * degenerate — a launcher editing a form can produce a configuration that has
 * not been validated yet, and a read-out that returns NaN or divides by zero is
 * worse than one that returns nothing.
 */
describe('deriveLaunchMetrics on degenerate input', () => {
  it('does not divide by zero when there is no supply', () => {
    const config = baselineConfig()
    config.tokenSupply = {
      preMigrationTokenSupply: new BN(0),
      postMigrationTokenSupply: new BN(0),
    }

    const metrics = deriveLaunchMetrics(config, SOL)
    expect(metrics.totalTokenSupply).toBe(0)
    expect(metrics.percentageSupplyOnMigration).toBe(0)
    expect(Number.isFinite(metrics.initialMarketCap)).toBe(true)
    expect(Number.isFinite(metrics.migrationMarketCap)).toBe(true)
  })

  it('does not report an infinite multiple when there is no supply figure', () => {
    const config = baselineConfig()
    config.tokenSupply = null
    const metrics = deriveLaunchMetrics(config, SOL)
    expect(metrics.totalTokenSupply).toBe(0)
    expect(Number.isFinite(metrics.priceMultiple)).toBe(true)
  })

  it('denominates in whatever it is told, not in SOL', () => {
    // Same curve, different quote asset: the threshold is read at the quote
    // asset's own precision, so 50 at nine decimals is not 50 at six.
    const config = baselineConfig({ quoteDecimals: 6, migrationQuoteThreshold: 750 })
    const metrics = deriveLaunchMetrics(config, USDC)
    expect(metrics.quoteSymbol).toBe('USDC')
    expect(metrics.migrationQuoteThreshold).toBeCloseTo(750, 6)
  })
})
