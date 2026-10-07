import BN from 'bn.js'
import { describe, expect, it } from 'vitest'

import { baselineConfig } from '../src/presets.js'
import { SOL, type QuoteAsset, TokenProgram } from '../src/quote-asset.js'
import { validateLaunchConfig } from '../src/validate.js'

const valid = () => baselineConfig()
const codes = (config: ReturnType<typeof valid>, asset?: QuoteAsset) =>
  validateLaunchConfig(config, asset).findings.map((f) => f.code)

describe('validateLaunchConfig', () => {
  it('accepts a configuration the program accepts', () => {
    const result = validateLaunchConfig(valid(), SOL)
    expect(result.valid).toBe(true)
    expect(result.findings).toEqual([])
  })

  it('rejects a fee above the program cap, and says what the cap is', () => {
    const config = valid()
    config.poolFees.baseFee.cliffFeeNumerator = new BN(999_000_000)
    const result = validateLaunchConfig(config)
    expect(result.valid).toBe(false)
    expect(result.findings[0]!.code).toBe('fee-above-maximum')
    expect(result.findings[0]!.message).toContain('99%')
    // The actual value, not just the limit, so it is clear how far off it is.
    expect(result.findings[0]!.message).toContain('99.9000%')
  })

  it('rejects a fee below the floor', () => {
    const config = valid()
    config.poolFees.baseFee.cliffFeeNumerator = new BN(1_000)
    expect(codes(config)).toContain('fee-below-minimum')
  })

  it('rejects a liquidity split that does not account for all of it', () => {
    const config = valid()
    config.partnerLiquidityPercentage = 80
    config.creatorLiquidityPercentage = 80
    expect(codes(config)).toContain('liquidity-split-not-whole')
  })

  it('rejects a creator fee share outside 0 to 100', () => {
    const config = valid()
    config.creatorTradingFeePercentage = 150
    expect(codes(config)).toContain('creator-fee-share-out-of-range')
  })

  it('rejects a threshold that can never be reached', () => {
    const config = valid()
    config.migrationQuoteThreshold = new BN(0)
    expect(codes(config)).toContain('migration-threshold-not-positive')
  })

  it('rejects a curve whose segments do not rise', () => {
    const config = valid()
    config.curve = [...config.curve].reverse()
    expect(codes(config)).toContain('curve-not-ascending')
  })

  it('reports every problem at once rather than stopping at the first', () => {
    const config = valid()
    config.creatorTradingFeePercentage = 150
    config.partnerLiquidityPercentage = 80
    config.creatorLiquidityPercentage = 80
    const found = codes(config)
    // A launcher fixing one number at a time learns nothing about the others.
    expect(found).toContain('creator-fee-share-out-of-range')
    expect(found).toContain('liquidity-split-not-whole')
  })
})

describe('quote-asset findings', () => {
  const equity: QuoteAsset = {
    mint: 'AAPLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    symbol: 'AAPLx',
    decimals: 6,
    program: TokenProgram.Token2022,
    extensions: ['TransferHook', 'PermanentDelegate'],
  }

  it('warns, rather than fails, when the quote mint needs a badge', () => {
    const result = validateLaunchConfig(valid(), equity)
    // The configuration is sound; it just cannot launch until Meteora badges
    // the mint. That is a conversation, not a number to change.
    expect(result.valid).toBe(true)
    expect(result.findings.map((f) => f.code)).toContain('quote-mint-requires-token-badge')
    expect(result.findings[0]!.severity).toBe('warning')
  })

  it('fails outright on a quote mint the program cannot accept', () => {
    const result = validateLaunchConfig(valid(), {
      ...equity,
      mint: '9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP',
    })
    expect(result.valid).toBe(false)
    expect(result.findings.map((f) => f.code)).toContain('quote-mint-ineligible')
  })

  it('says nothing about the quote asset when none is given', () => {
    expect(codes(valid())).toEqual([])
  })
})

describe('the backstop', () => {
  it('catches what the explicit checks do not', () => {
    const config = valid()
    // Nothing above inspects the migration fee, so this can only be caught by
    // deferring to the SDK. The backstop is the reason a gap in the checks
    // above degrades to a terser message rather than to a false pass.
    config.migrationFee = { feePercentage: 200, creatorFeePercentage: 0 }

    const result = validateLaunchConfig(config)
    expect(result.valid).toBe(false)
    expect(result.findings.map((f) => f.code)).toContain('program-would-reject')
    expect(result.findings[0]!.message).toContain('The program would reject')
  })

  it('is not consulted once an explicit check has already failed', () => {
    const config = valid()
    config.creatorTradingFeePercentage = 150
    config.migrationFee = { feePercentage: 200, creatorFeePercentage: 0 }

    // Running it anyway would bury a precise message under a vague one.
    const codesFound = codes(config)
    expect(codesFound).toContain('creator-fee-share-out-of-range')
    expect(codesFound).not.toContain('program-would-reject')
  })

  it('rejects a curve with no segments at all', () => {
    const config = valid()
    config.curve = []
    expect(codes(config)).toContain('curve-empty')
  })
})
