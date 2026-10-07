import {
  type ConfigParameters,
  getCurveBreakdown,
  getMigrationBaseToken,
  getPriceFromSqrtPrice,
  type MigrationOption,
  type TokenDecimal,
} from '@meteora-ag/dynamic-bonding-curve-sdk'

import { oneWholeUnit, type QuoteAsset } from './quote-asset.js'

/**
 * The numbers a launcher actually wants to see before committing to a curve.
 *
 * A configuration is a pile of square-root prices in Q64.64 and liquidity
 * values with thirty digits. None of that answers "what does my token start at,
 * what is it worth when it graduates, and how much of the supply have I sold by
 * then?" — which are the only questions that matter when choosing between two
 * curves.
 *
 * This is also the layer where decimals enter. The engine never sees them; here
 * they are the whole point, because a price is meaningless without them.
 */

export interface LaunchMetrics {
  /** Price of one whole base token, in whole quote tokens, at launch. */
  readonly initialPrice: number
  /** Price of one whole base token when the curve graduates. */
  readonly migrationPrice: number
  /** Square-root price at graduation, as the program stores it. */
  readonly migrationSqrtPrice: bigint
  /** How many times the price rises from launch to graduation. */
  readonly priceMultiple: number
  /** Fully diluted value at launch, in whole quote tokens. */
  readonly initialMarketCap: number
  /** Fully diluted value at graduation. */
  readonly migrationMarketCap: number
  /** Quote raised before the curve graduates, in whole quote tokens. */
  readonly migrationQuoteThreshold: number
  /** Total base supply, in whole tokens. */
  readonly totalTokenSupply: number
  /** Base tokens handed to the DAMM pool at migration, in whole tokens. */
  readonly migrationBaseTokens: number
  /** Share of total supply that migrates rather than being sold on the curve. */
  readonly percentageSupplyOnMigration: number
  /** The base fee at launch, as a percentage. */
  readonly startingFeePercent: number
  /** The quote asset these figures are denominated in. */
  readonly quoteSymbol: string
}

const asBig = (value: { toString(): string }): bigint => BigInt(value.toString())

/** Convert an atomic amount to whole tokens, as a float for display. */
function toWhole(atomic: bigint, decimals: number): number {
  return Number(atomic) / Number(10n ** BigInt(decimals))
}

/**
 * Derive the human-facing figures for a configuration.
 *
 * `baseDecimals` is taken from the config itself; the quote asset supplies its
 * own, which is why the two cannot be mixed up here the way they can when
 * building a curve.
 */
export function deriveLaunchMetrics(
  config: ConfigParameters,
  quoteAsset: QuoteAsset,
): LaunchMetrics {
  const baseDecimals = config.tokenDecimal as TokenDecimal
  const quoteDecimals = quoteAsset.decimals

  const initialPrice = getPriceFromSqrtPrice(
    config.sqrtStartPrice,
    baseDecimals,
    quoteDecimals,
  ).toNumber()

  // Where the curve graduates is where the quote threshold is reached, which is
  // not necessarily a segment boundary — it is usually part-way through one.
  // Taking the last curve point instead would overstate the migration price.
  const { finalSqrtPrice } = getCurveBreakdown(
    config.migrationQuoteThreshold,
    config.sqrtStartPrice,
    config.curve,
  )
  const migrationPrice = getPriceFromSqrtPrice(
    finalSqrtPrice,
    baseDecimals,
    quoteDecimals,
  ).toNumber()

  const totalSupplyAtomic = asBig(config.tokenSupply?.preMigrationTokenSupply ?? 0n)
  const totalTokenSupply = toWhole(totalSupplyAtomic, baseDecimals)
  // Base tokens seeded into the DAMM pool at graduation, derived the same way
  // the program derives them rather than read off the configuration, which does
  // not carry the figure.
  const migrationBaseAtomic = asBig(
    getMigrationBaseToken(
      config.migrationQuoteThreshold,
      finalSqrtPrice,
      config.migrationOption as MigrationOption,
    ),
  )
  const migrationBaseTokens = toWhole(migrationBaseAtomic, baseDecimals)

  const thresholdAtomic = asBig(config.migrationQuoteThreshold)
  const migrationQuoteThreshold = Number(thresholdAtomic) / Number(oneWholeUnit(quoteAsset))

  const startingFeePercent =
    Number((asBig(config.poolFees.baseFee.cliffFeeNumerator) * 1_000_000n) / 1_000_000_000n) /
    10_000

  return {
    initialPrice,
    migrationPrice,
    migrationSqrtPrice: asBig(finalSqrtPrice),
    priceMultiple: initialPrice > 0 ? migrationPrice / initialPrice : 0,
    initialMarketCap: initialPrice * totalTokenSupply,
    migrationMarketCap: migrationPrice * totalTokenSupply,
    migrationQuoteThreshold,
    totalTokenSupply,
    migrationBaseTokens,
    percentageSupplyOnMigration:
      totalTokenSupply > 0 ? (migrationBaseTokens / totalTokenSupply) * 100 : 0,
    startingFeePercent,
    quoteSymbol: quoteAsset.symbol,
  }
}
