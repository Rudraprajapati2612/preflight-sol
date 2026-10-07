import {
  ActivationType,
  BaseFeeMode,
  buildCurve,
  CollectFeeMode,
  type ConfigParameters,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
} from '@meteora-ag/dynamic-bonding-curve-sdk'

/**
 * Starting points for a launch.
 *
 * These are deliberately plain. A single well-understood curve is worth more
 * than a wide menu while every field of every resulting swap is being asserted
 * against real program output, and a launcher is better served by one shape
 * they can reason about than by ten they cannot.
 */

export interface BaselineOptions {
  /**
   * Decimals of the quote asset. DBC accepts any SPL mint as quote, and live
   * pools use SOL (9), USDC (6) and arbitrary project tokens (6), so this is a
   * real axis rather than a hypothetical one.
   */
  readonly quoteDecimals?: TokenDecimal
  /** Decimals of the token being launched. */
  readonly baseDecimals?: TokenDecimal
  /**
   * Quote raised before the curve graduates, in whole quote tokens. The right
   * value differs by quote asset: 50 SOL and 50 USDC are not comparable sums.
   */
  readonly migrationQuoteThreshold?: number
  /** Total supply of the launched token. */
  readonly totalTokenSupply?: number
  /**
   * Share of the total supply seeded into the graduated DAMM pool rather than
   * sold on the curve, as a percentage. Raising it leaves less supply for the
   * curve to sell, so the same raise has to come out of a steeper climb.
   *
   * The SDK's curve builder underflows at exactly 50 — swept, and 49 is fine —
   * so a caller offering this as a control should stop short of it.
   */
  readonly percentageSupplyOnMigration?: number
  /**
   * Enable the volatility-driven dynamic fee on top of the base fee. Off by
   * default so the baseline recording isolates curve mechanics.
   */
  readonly dynamicFee?: boolean
  /**
   * Where the fee is taken. `QuoteToken` takes it on the way in when buying;
   * `OutputToken` takes it out of the token being bought, which credits the
   * base-token fee buckets instead of the quote ones.
   */
  readonly collectFeeMode?: CollectFeeMode
  /**
   * Share of the trading fee routed to the launch creator rather than the
   * partner, as a percentage. Zero means the partner takes all of it.
   */
  readonly creatorTradingFeePercentage?: number
  /** Base fee at launch, in basis points. The program allows 25 to 9900. */
  readonly startingFeeBps?: number
  /** Base fee once the schedule has run its course. Defaults to the start. */
  readonly endingFeeBps?: number
  /**
   * Decay the fee over time rather than holding it flat.
   *
   * A high opening fee that falls away is the standard defence against being
   * sniped: expensive to be first, ordinary to arrive later.
   */
  readonly feeSchedule?: {
    readonly mode: 'linear' | 'exponential'
    readonly numberOfPeriod: number
    readonly totalDuration: number
  }
  /**
   * Whether the fee schedule counts slots or wall-clock seconds. Slots are
   * about 400ms, so the same schedule expressed in slots runs far shorter.
   */
  readonly activationType?: ActivationType
}

/**
 * A baseline launch: two curve segments, a flat 1% fee, no dynamic fee, fees
 * collected in the quote token, graduating to DAMM v2.
 *
 * A flat fee schedule (start == end) is chosen on purpose so that the first
 * fixtures isolate curve mechanics from fee decay; time-varying fees are a
 * separate scenario.
 */
export function baselineConfig(options: BaselineOptions = {}): ConfigParameters {
  return buildCurve({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: options.baseDecimals ?? TokenDecimal.SIX,
      tokenQuoteDecimal: options.quoteDecimals ?? TokenDecimal.NINE,
      tokenAuthorityOption: TokenAuthorityOption.CreatorUpdateAuthority,
      totalTokenSupply: options.totalTokenSupply ?? 1_000_000_000,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode:
          options.feeSchedule?.mode === 'exponential'
            ? BaseFeeMode.FeeSchedulerExponential
            : BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: options.startingFeeBps ?? 100,
          endingFeeBps: options.endingFeeBps ?? options.startingFeeBps ?? 100,
          numberOfPeriod: options.feeSchedule?.numberOfPeriod ?? 0,
          totalDuration: options.feeSchedule?.totalDuration ?? 0,
        },
      },
      dynamicFeeEnabled: options.dynamicFee ?? false,
      collectFeeMode: options.collectFeeMode ?? CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: options.creatorTradingFeePercentage ?? 0,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 100,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: options.activationType ?? ActivationType.Timestamp,
    percentageSupplyOnMigration: options.percentageSupplyOnMigration ?? 20,
    migrationQuoteThreshold: options.migrationQuoteThreshold ?? 50,
  })
}

/**
 * Quote assets that mirror what DBC is actually used with in production.
 *
 * A survey of 500 live DBC pools found SOL at 9 decimals, USDC at 6, and
 * project tokens at 6. Meteora's StockLaunch additionally pairs launches
 * against Backpack-issued equities. The engine must not privilege any of them.
 */
export const QUOTE_ASSET_PROFILES = [
  { label: 'SOL', decimals: TokenDecimal.NINE, migrationQuoteThreshold: 50 },
  { label: 'USDC', decimals: TokenDecimal.SIX, migrationQuoteThreshold: 10_000 },
  { label: 'tokenized equity', decimals: TokenDecimal.SIX, migrationQuoteThreshold: 750 },
] as const
