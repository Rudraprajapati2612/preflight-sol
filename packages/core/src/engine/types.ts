/**
 * The engine's own view of a DBC pool, in `bigint`.
 *
 * Everything here is in raw atomic units. There are no decimals, no ticker
 * symbols and no fiat prices — those belong to layers above this one, and
 * keeping them out is what lets one engine serve a SOL-quoted memecoin and a
 * stablecoin- or equity-quoted launch without branching.
 *
 * `bigint` rather than BN: an agent simulation executes thousands of swaps per
 * run, and a single numeric dialect across the engine, its metrics and its
 * agents is worth more than matching the SDK's types at every call site. The
 * conversion to BN is confined to `sdk-bridge.ts`.
 */

/** One segment of the piecewise curve. */
export interface CurvePoint {
  readonly sqrtPrice: bigint
  readonly liquidity: bigint
}

/** `BaseFeeMode` in the program. RateLimiter is deprecated and unmodelled. */
export const BaseFeeMode = {
  FeeSchedulerLinear: 0,
  FeeSchedulerExponential: 1,
  RateLimiter: 2,
} as const

/** `CollectFeeMode` in the program. */
export const CollectFeeMode = {
  QuoteToken: 0,
  OutputToken: 1,
} as const

/** `TradeDirection` in the program. */
export const TradeDirection = {
  BaseToQuote: 0,
  QuoteToBase: 1,
} as const
export type TradeDirection = (typeof TradeDirection)[keyof typeof TradeDirection]

/** `ActivationType`: whether `currentPoint` counts slots or unix seconds. */
export const ActivationType = {
  Slot: 0,
  Timestamp: 1,
} as const

export interface BaseFeeConfig {
  readonly cliffFeeNumerator: bigint
  /** `numberOfPeriod` for a fee scheduler. */
  readonly firstFactor: number
  /** `periodFrequency` for a fee scheduler. */
  readonly secondFactor: bigint
  /** `reductionFactor` for a fee scheduler. */
  readonly thirdFactor: bigint
  readonly baseFeeMode: number
}

export interface DynamicFeeConfig {
  readonly initialized: number
  readonly maxVolatilityAccumulator: number
  readonly variableFeeControl: number
  readonly binStep: number
  readonly filterPeriod: number
  readonly decayPeriod: number
  readonly reductionFactor: number
  readonly binStepU128: bigint
}

export interface PoolFeesConfig {
  readonly baseFee: BaseFeeConfig
  readonly dynamicFee: DynamicFeeConfig
}

/** The immutable half of a pool: everything fixed when the config is created. */
export interface EngineConfig {
  readonly curve: readonly CurvePoint[]
  readonly sqrtStartPrice: bigint
  readonly migrationQuoteThreshold: bigint
  readonly migrationSqrtPrice: bigint
  readonly collectFeeMode: number
  readonly activationType: number
  readonly poolFees: PoolFeesConfig
  readonly creatorTradingFeePercentage: number
  /**
   * Base tokens the curve can sell, and those held back to seed the pool at
   * graduation. Their sum is what the vault holds when a pool opens.
   *
   * Carried so that a simulated pool starts from the supply the program would
   * actually give it. Inventing a large number instead works — nothing in the
   * pricing depends on it — but it means the base reserve shown to anyone
   * reading the result is fiction.
   */
  readonly swapBaseAmount: bigint
  readonly migrationBaseThreshold: bigint
  /** Supply the launch commits to up front, when it commits to one. */
  readonly preMigrationTokenSupply: bigint
  readonly fixedTokenSupply: boolean
  /** Base locked into a vesting schedule rather than left in the vault. */
  readonly lockedVestingAmount: bigint
  readonly enableFirstSwapWithMinFee: boolean
}

/**
 * Volatility state. Decays on wall-clock seconds, which is a different clock
 * from the one the fee scheduler reads — conflating the two is the most common
 * modelling error in DBC.
 */
export interface VolatilityTracker {
  readonly lastUpdateTimestamp: bigint
  readonly sqrtPriceReference: bigint
  readonly volatilityAccumulator: bigint
  readonly volatilityReference: bigint
}

/** The mutable half of a pool: everything a swap changes. */
/**
 * Base the vault holds when a pool opens, before anything is sold.
 *
 * Ported from `PoolConfig::get_initial_base_supply`. A launch that fixes its
 * supply gets exactly that; otherwise the program mints what the curve has to
 * sell, plus what seeds the graduated pool, plus whatever is locked into
 * vesting. The two differ by the rounding in the swap amount's buffer, so
 * taking one rule for both is wrong by a small amount that never settles.
 */
export function openingBaseReserve(config: EngineConfig): bigint {
  if (config.fixedTokenSupply) return config.preMigrationTokenSupply
  return config.swapBaseAmount + config.migrationBaseThreshold + config.lockedVestingAmount
}

export interface PoolState {
  readonly sqrtPrice: bigint
  readonly baseReserve: bigint
  readonly quoteReserve: bigint
  readonly protocolBaseFee: bigint
  readonly protocolQuoteFee: bigint
  readonly partnerBaseFee: bigint
  readonly partnerQuoteFee: bigint
  readonly creatorBaseFee: bigint
  readonly creatorQuoteFee: bigint
  readonly activationPoint: bigint
  readonly volatilityTracker: VolatilityTracker
  readonly hasSwap: boolean
}

/** Mirrors the program's `SwapResult2`. */
export interface SwapResult {
  readonly includedFeeInputAmount: bigint
  readonly excludedFeeInputAmount: bigint
  readonly amountLeft: bigint
  readonly outputAmount: bigint
  readonly nextSqrtPrice: bigint
  readonly tradingFee: bigint
  readonly protocolFee: bigint
  readonly referralFee: bigint
}

/** Mirrors the program's `FeeMode`, derived from collect mode and direction. */
export interface FeeMode {
  readonly feesOnInput: boolean
  readonly feesOnBaseToken: boolean
  readonly hasReferral: boolean
}

/**
 * Which token a fee is taken in, and whether it comes off the input or the
 * output. Ported from `FeeMode::get_fee_mode` in the program.
 */
export function getFeeMode(
  collectFeeMode: number,
  tradeDirection: TradeDirection,
  hasReferral: boolean,
): FeeMode {
  const quoteOnly = collectFeeMode === CollectFeeMode.QuoteToken
  const buying = tradeDirection === TradeDirection.QuoteToBase
  return {
    // Only a quote-token-mode buy takes its fee on the way in.
    feesOnInput: quoteOnly && buying,
    // Output-token mode on a buy is the one case that accrues base-token fees.
    feesOnBaseToken: !quoteOnly && buying,
    hasReferral,
  }
}
