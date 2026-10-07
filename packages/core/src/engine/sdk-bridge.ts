import {
  getBaseFeeNumerator,
  getSwapResultFromExactInput,
  getSwapResultFromExactOutput,
  getSwapResultFromPartialInput,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import BN from 'bn.js'

import type { EngineConfig, FeeMode, PoolState, SwapResult, TradeDirection } from './types.js'

/**
 * The single place where the engine speaks BN.
 *
 * Meteora's SDK already contains a faithful port of the per-swap curve and fee
 * arithmetic, and reimplementing it would add risk without adding assurance —
 * the differential tests are what establish correctness either way. What the
 * SDK does not provide is the stateful layer around it, which is the engine's
 * actual job.
 *
 * So the engine keeps its state in `bigint` and converts at this boundary only,
 * the same way `tx.ts` confines the web3.js/kit divide to one module. If the
 * differential tests ever show the SDK's math diverging from deployed bytecode,
 * this is the seam where a hand-written port replaces it.
 */

const bn = (value: bigint): BN => new BN(value.toString())
const big = (value: { toString(): string }): bigint => BigInt(value.toString())

/**
 * The shape the SDK's swap math reads out of a config account.
 *
 * Built explicitly rather than by casting a decoded account, so that a field
 * the SDK starts depending on shows up as a type error here instead of as
 * `undefined` inside the arithmetic.
 */
function toSdkConfig(config: EngineConfig) {
  const { baseFee, dynamicFee } = config.poolFees
  return {
    curve: config.curve.map((point) => ({
      sqrtPrice: bn(point.sqrtPrice),
      liquidity: bn(point.liquidity),
    })),
    sqrtStartPrice: bn(config.sqrtStartPrice),
    migrationSqrtPrice: bn(config.migrationSqrtPrice),
    migrationQuoteThreshold: bn(config.migrationQuoteThreshold),
    collectFeeMode: config.collectFeeMode,
    activationType: config.activationType,
    creatorTradingFeePercentage: config.creatorTradingFeePercentage,
    poolFees: {
      baseFee: {
        cliffFeeNumerator: bn(baseFee.cliffFeeNumerator),
        firstFactor: baseFee.firstFactor,
        secondFactor: bn(baseFee.secondFactor),
        thirdFactor: bn(baseFee.thirdFactor),
        baseFeeMode: baseFee.baseFeeMode,
      },
      dynamicFee: {
        initialized: dynamicFee.initialized,
        maxVolatilityAccumulator: dynamicFee.maxVolatilityAccumulator,
        variableFeeControl: dynamicFee.variableFeeControl,
        binStep: dynamicFee.binStep,
        filterPeriod: dynamicFee.filterPeriod,
        decayPeriod: dynamicFee.decayPeriod,
        reductionFactor: dynamicFee.reductionFactor,
        binStepU128: bn(dynamicFee.binStepU128),
      },
    },
  }
}

/**
 * The SDK's swap math reads exactly three things out of the pool: the current
 * price, the activation point the fee scheduler measures from, and the
 * volatility tracker. Everything else a pool holds is the engine's to maintain.
 */
function toSdkPool(state: PoolState) {
  return {
    poolState: {
      sqrtPrice: bn(state.sqrtPrice),
      activationPoint: bn(state.activationPoint),
      volatilityTracker: {
        lastUpdateTimestamp: bn(state.volatilityTracker.lastUpdateTimestamp),
        sqrtPriceReference: bn(state.volatilityTracker.sqrtPriceReference),
        volatilityAccumulator: bn(state.volatilityTracker.volatilityAccumulator),
        volatilityReference: bn(state.volatilityTracker.volatilityReference),
      },
    },
  }
}

function fromSdkResult(result: {
  includedFeeInputAmount: BN
  excludedFeeInputAmount: BN
  amountLeft: BN
  outputAmount: BN
  nextSqrtPrice: BN
  tradingFee: BN
  protocolFee: BN
  referralFee: BN
}): SwapResult {
  return {
    includedFeeInputAmount: big(result.includedFeeInputAmount),
    excludedFeeInputAmount: big(result.excludedFeeInputAmount),
    amountLeft: big(result.amountLeft),
    outputAmount: big(result.outputAmount),
    nextSqrtPrice: big(result.nextSqrtPrice),
    tradingFee: big(result.tradingFee),
    protocolFee: big(result.protocolFee),
    referralFee: big(result.referralFee),
  }
}

export interface QuoteArgs {
  readonly config: EngineConfig
  readonly state: PoolState
  /** Offered for an exact-in or partial fill; demanded for an exact-out. */
  readonly amountIn: bigint
  readonly feeMode: FeeMode
  readonly tradeDirection: TradeDirection
  /** Slot or unix second, depending on the config's activation type. */
  readonly currentPoint: bigint
  readonly eligibleForFirstSwapWithMinFee: boolean
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Exact-in: the whole input must be consumable, or the program would revert. */
export function quoteExactIn(args: QuoteArgs): SwapResult {
  const result = getSwapResultFromExactInput(
    toSdkPool(args.state) as any,
    toSdkConfig(args.config) as any,
    bn(args.amountIn),
    args.feeMode,
    args.tradeDirection,
    bn(args.currentPoint),
    args.eligibleForFirstSwapWithMinFee,
  )
  return fromSdkResult(result as never)
}

/**
 * Partial fill: consumes only what the curve can absorb before the migration
 * price and reports the rest as `amountLeft`. This is the path the final trade
 * of a launch takes.
 */
export function quotePartialFill(args: QuoteArgs): SwapResult {
  const result = getSwapResultFromPartialInput(
    toSdkPool(args.state) as any,
    toSdkConfig(args.config) as any,
    bn(args.amountIn),
    args.feeMode,
    args.tradeDirection,
    bn(args.currentPoint),
    args.eligibleForFirstSwapWithMinFee,
  )
  return fromSdkResult(result as never)
}

/**
 * Exact-out: the trader states what they want and the curve decides the cost.
 *
 * The reverse of every other path here, which price a trade from what is
 * offered. Worth keeping distinct rather than folding in, because the argument
 * changes meaning: the same number is an input in one mode and an output in the
 * other, and reading it wrongly prices a trade that never happened.
 */
export function quoteExactOut(args: QuoteArgs): SwapResult {
  const result = getSwapResultFromExactOutput(
    toSdkPool(args.state) as any,
    toSdkConfig(args.config) as any,
    bn(args.amountIn),
    args.feeMode,
    args.tradeDirection,
    bn(args.currentPoint),
    args.eligibleForFirstSwapWithMinFee,
  )
  return fromSdkResult(result as never)
}

/**
 * The base fee a trade would pay at this point on the clock.
 *
 * The swap functions apply this internally and do not report it, but a trader
 * can read the config account and work out today's fee before deciding to
 * trade — so an agent that cannot see it is blinder than a real one, not more
 * conservative. Taken from the SDK's own scheduler rather than recomputed, for
 * the same reason the swap math is.
 *
 * `FEE_DENOMINATOR` is 1e9; the caller divides.
 */
export function baseFeeNumeratorAt(
  config: EngineConfig,
  currentPoint: bigint,
  activationPoint: bigint,
): bigint {
  const { baseFee } = config.poolFees
  return big(
    getBaseFeeNumerator(
      bn(baseFee.cliffFeeNumerator),
      baseFee.firstFactor,
      bn(baseFee.secondFactor),
      bn(baseFee.thirdFactor),
      baseFee.baseFeeMode,
      bn(currentPoint),
      bn(activationPoint),
    ),
  )
}
