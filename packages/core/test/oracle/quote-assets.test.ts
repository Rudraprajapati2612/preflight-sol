import { describe, expect, it } from 'vitest'

import { DbcOracle } from '../../src/oracle/harness.js'
import { baselineConfig, QUOTE_ASSET_PROFILES } from '@preflight/config'

/**
 * DBC accepts any SPL mint as the quote asset, so a launch can be priced in
 * SOL, in a stablecoin, or in a tokenized equity. These tests run the same
 * curve against each profile on the real program to confirm that claim holds
 * in practice rather than only in the documentation, and that nothing in the
 * harness has quietly assumed nine decimals.
 */

interface SwapEvent {
  swapResult: {
    includedFeeInputAmount: string
    excludedFeeInputAmount: string
    tradingFee: string
    protocolFee: string
    nextSqrtPrice: string
  }
  quoteReserveAmount: string
  migrationThreshold: string
}

const asBig = (v: { toString(): string }) => BigInt(v.toString())

describe.each(QUOTE_ASSET_PROFILES)(
  'quote asset: $label ($decimals decimals)',
  ({ decimals, migrationQuoteThreshold }) => {
    it('launches, prices and charges fees identically regardless of quote asset', async () => {
      const oracle = await DbcOracle.create({
        quoteDecimals: decimals,
        seed: `quote-${decimals}-${migrationQuoteThreshold}`,
      })
      const params = baselineConfig({ quoteDecimals: decimals, migrationQuoteThreshold })

      const config = await oracle.createConfig(params)
      const handle = await oracle.createPool(config, {
        name: `Preflight ${decimals}d`,
        symbol: 'PFQ',
        uri: 'https://example.invalid/pfq.json',
      })

      const one = 10n ** BigInt(decimals)
      await oracle.fundQuote(oracle.payer.publicKey, one * BigInt(migrationQuoteThreshold) * 2n)

      const amountIn = one * BigInt(Math.max(1, Math.floor(migrationQuoteThreshold / 50)))
      const observation = await oracle.swap(handle, { amountIn, swapBaseForQuote: false })
      const event = observation.event as unknown as SwapEvent
      expect(event).not.toBeNull()

      const included = asBig(event.swapResult.includedFeeInputAmount)
      const excluded = asBig(event.swapResult.excludedFeeInputAmount)
      const trading = asBig(event.swapResult.tradingFee)
      const protocol = asBig(event.swapResult.protocolFee)

      // The same 100 bps fee, expressed in whatever the quote asset is.
      expect(included).toBe(amountIn)
      expect(included - excluded).toBe(amountIn / 100n)
      // The 20% protocol share is a property of the program, not of the asset.
      expect(protocol).toBe((included - excluded) / 5n)
      expect(trading).toBe(included - excluded - protocol)

      // The curve moved, and the threshold is denominated in the quote asset.
      expect(asBig(event.swapResult.nextSqrtPrice)).toBeGreaterThan(asBig(params.sqrtStartPrice))
      expect(asBig(event.migrationThreshold)).toBe(one * BigInt(migrationQuoteThreshold))
      expect(asBig(event.quoteReserveAmount)).toBe(excluded)
    })
  },
)

describe('quote-asset agnosticism', () => {
  it('produces the same curve shape for stable- and equity-quoted launches at equal scale', async () => {
    // Same decimals, same threshold, different intended asset: the program
    // cannot tell them apart, and neither should anything we build on it.
    const stable = baselineConfig({ quoteDecimals: 6, migrationQuoteThreshold: 750 })
    const equity = baselineConfig({ quoteDecimals: 6, migrationQuoteThreshold: 750 })

    expect(stable.sqrtStartPrice.toString()).toBe(equity.sqrtStartPrice.toString())
    expect(stable.migrationQuoteThreshold.toString()).toBe(
      equity.migrationQuoteThreshold.toString(),
    )
    expect(stable.curve.map((p) => p.sqrtPrice.toString())).toEqual(
      equity.curve.map((p) => p.sqrtPrice.toString()),
    )
  })
})
