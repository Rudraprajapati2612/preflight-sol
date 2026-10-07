import { baseFeeNumeratorAt, quoteExactIn, quoteExactOut, quotePartialFill } from './sdk-bridge.js'
import {
  ActivationType,
  type EngineConfig,
  getFeeMode,
  type PoolState,
  type SwapResult,
  TradeDirection,
  type VolatilityTracker,
} from './types.js'

/**
 * The stateful half of a Dynamic Bonding Curve.
 *
 * Meteora's SDK can price a single swap against a given pool state. What it
 * cannot do — and what a simulator needs — is carry that state forward: apply a
 * swap to the reserves and fee buckets, evolve the volatility tracker, advance
 * the fee scheduler as time passes, and recognise when the curve has completed.
 * That is what this class is.
 *
 * Every quantity is a raw atomic amount. The pool has no idea whether it is
 * quoted in SOL, a stablecoin or a tokenized equity, and nothing here branches
 * on that.
 */

/** `BASIS_POINT_MAX` in the program. */
const BASIS_POINT_MAX = 10_000n
/** Q64.64 one. */
const ONE_Q64 = 1n << 64n

/**
 * Mirrors the program's `safe_sub`: underflow is an error, never a wrap.
 *
 * This is belt and braces. In practice a partial fill caps the trade at what
 * the curve can absorb, and an exact fill is rejected before it gets here, so
 * the guard has no known reachable path — which is exactly why it stays. An
 * arithmetic slip that silently wrapped a reserve would be far worse than one
 * that stops.
 */
function safeSub(a: bigint, b: bigint, what: string): bigint {
  const result = a - b
  if (result < 0n) {
    throw new Error(`${what} would underflow: ${a} - ${b}`)
  }
  return result
}

/**
 * `VolatilityTracker::get_delta_bin_id`.
 *
 * The program approximates the bin distance between two prices as
 * `((upper << 64) / lower - 1) / bin_step`, doubled. Integer division
 * throughout, matching the on-chain truncation exactly.
 */
function getDeltaBinId(binStepU128: bigint, sqrtPriceA: bigint, sqrtPriceB: bigint): bigint {
  const upper = sqrtPriceA > sqrtPriceB ? sqrtPriceA : sqrtPriceB
  const lower = sqrtPriceA > sqrtPriceB ? sqrtPriceB : sqrtPriceA
  if (lower === 0n) return 0n
  const priceRatio = (upper << 64n) / lower
  if (binStepU128 === 0n) return 0n
  return ((priceRatio - ONE_Q64) / binStepU128) * 2n
}

/**
 * How a trade is specified.
 *
 * `exactIn` and `partialFill` price from what is offered; they differ only in
 * whether an amount the curve cannot absorb is an error or is handed back.
 * `exactOut` is the other way round — the trader names what they want.
 */
export type SwapMode = 'exactIn' | 'partialFill' | 'exactOut'

export interface SwapOptions {
  /** Slot or unix second, per the config's activation type. */
  readonly currentPoint: bigint
  /** Wall-clock seconds. Volatility decay always uses this, never the point. */
  readonly currentTimestamp: bigint
  readonly hasReferral?: boolean
}

export interface SwapOutcome {
  readonly result: SwapResult
  readonly stateBefore: PoolState
  readonly stateAfter: PoolState
}

export class VirtualPool {
  private current: PoolState

  constructor(
    readonly config: EngineConfig,
    initialState: PoolState,
  ) {
    this.current = initialState
  }

  get state(): PoolState {
    return this.current
  }

  /** True once the quote raised has reached the migration threshold. */
  get isCurveComplete(): boolean {
    return this.current.quoteReserve >= this.config.migrationQuoteThreshold
  }

  private get dynamicFeeEnabled(): boolean {
    return this.config.poolFees.dynamicFee.initialized !== 0
  }

  /**
   * Buy base with quote. `partialFill` consumes only what the curve can absorb
   * before the migration price; exact-in requires the whole input to fit, which
   * is what the program enforces.
   */
  buy(amountIn: bigint, options: SwapOptions & { partialFill?: boolean }): SwapOutcome {
    return this.swap(amountIn, TradeDirection.QuoteToBase, options)
  }

  /**
   * Buy a stated amount of the base token, whatever it costs.
   *
   * `amountOut` is what the trader receives; the curve decides the input.
   */
  buyExactOut(amountOut: bigint, options: SwapOptions): SwapOutcome {
    return this.swap(amountOut, TradeDirection.QuoteToBase, { ...options, mode: 'exactOut' })
  }

  /** Sell base for quote. */
  sell(amountIn: bigint, options: SwapOptions & { partialFill?: boolean }): SwapOutcome {
    return this.swap(amountIn, TradeDirection.BaseToQuote, options)
  }

  /**
   * The base fee a trade would pay at this point on the clock, as a fraction.
   *
   * Excludes the dynamic fee, which depends on volatility the caller cannot
   * predict; this is the scheduled part, which is published in the config and
   * which a trader can therefore work out in advance. `FEE_DENOMINATOR` is 1e9.
   */
  baseFeeFraction(currentPoint: bigint): number {
    const numerator = baseFeeNumeratorAt(this.config, currentPoint, this.current.activationPoint)
    return Number(numerator) / 1e9
  }

  swap(
    amountIn: bigint,
    tradeDirection: TradeDirection,
    options: SwapOptions & { partialFill?: boolean; mode?: SwapMode },
  ): SwapOutcome {
    const stateBefore = this.current
    const feeMode = getFeeMode(
      this.config.collectFeeMode,
      tradeDirection,
      options.hasReferral ?? false,
    )

    // Pre-swap decay happens before the quote, so the fee this trade pays
    // reflects how long the pool has been quiet.
    const decayed = this.updatePreSwap(stateBefore, options.currentTimestamp)

    const args = {
      config: this.config,
      state: decayed,
      amountIn,
      feeMode,
      tradeDirection,
      currentPoint: options.currentPoint,
      eligibleForFirstSwapWithMinFee: this.config.enableFirstSwapWithMinFee && !decayed.hasSwap,
    }
    const mode: SwapMode = options.mode ?? (options.partialFill ? 'partialFill' : 'exactIn')
    const result =
      mode === 'exactOut'
        ? quoteExactOut(args)
        : mode === 'partialFill'
          ? quotePartialFill(args)
          : quoteExactIn(args)

    this.current = this.applySwapResult(
      decayed,
      result,
      feeMode,
      tradeDirection,
      options.currentTimestamp,
    )
    return { result, stateBefore, stateAfter: this.current }
  }

  /** `VirtualPool::update_pre_swap` — decays volatility toward its reference. */
  private updatePreSwap(state: PoolState, currentTimestamp: bigint): PoolState {
    if (!this.dynamicFeeEnabled) return state
    const { filterPeriod, decayPeriod, reductionFactor } = this.config.poolFees.dynamicFee
    const tracker = state.volatilityTracker

    // saturating_sub: an out-of-order clock must not produce a huge elapsed.
    const elapsed =
      currentTimestamp > tracker.lastUpdateTimestamp
        ? currentTimestamp - tracker.lastUpdateTimestamp
        : 0n
    if (elapsed < BigInt(filterPeriod)) return state

    const volatilityReference =
      elapsed < BigInt(decayPeriod)
        ? (tracker.volatilityAccumulator * BigInt(reductionFactor)) / BASIS_POINT_MAX
        : 0n

    return {
      ...state,
      volatilityTracker: {
        ...tracker,
        sqrtPriceReference: state.sqrtPrice,
        volatilityReference,
      },
    }
  }

  /** `VirtualPool::update_post_swap` — accumulates the move just made. */
  private updatePostSwap(
    tracker: VolatilityTracker,
    oldSqrtPrice: bigint,
    newSqrtPrice: bigint,
    currentTimestamp: bigint,
  ): VolatilityTracker {
    if (!this.dynamicFeeEnabled) return tracker
    const { binStepU128, maxVolatilityAccumulator } = this.config.poolFees.dynamicFee

    const delta = getDeltaBinId(binStepU128, newSqrtPrice, tracker.sqrtPriceReference)
    const accumulated = tracker.volatilityReference + delta * BASIS_POINT_MAX
    const capped =
      accumulated > BigInt(maxVolatilityAccumulator)
        ? BigInt(maxVolatilityAccumulator)
        : accumulated

    // The timestamp only advances when the trade actually crossed a bin.
    const crossed = getDeltaBinId(binStepU128, oldSqrtPrice, newSqrtPrice) > 0n

    return {
      ...tracker,
      volatilityAccumulator: capped,
      lastUpdateTimestamp: crossed ? currentTimestamp : tracker.lastUpdateTimestamp,
    }
  }

  /** `VirtualPool::apply_swap_result`. */
  private applySwapResult(
    state: PoolState,
    result: SwapResult,
    feeMode: { feesOnInput: boolean; feesOnBaseToken: boolean },
    tradeDirection: TradeDirection,
    currentTimestamp: bigint,
  ): PoolState {
    const oldSqrtPrice = state.sqrtPrice

    // `actual_input_amount` in the program is the fee-exclusive input.
    const actualInputAmount = result.excludedFeeInputAmount

    // When the fee is taken on the output, the pool still has to move the
    // gross amount out of its reserve; the fee is retained, not un-spent.
    const actualOutputAmount = feeMode.feesOnInput
      ? result.outputAmount
      : result.outputAmount + result.tradingFee + result.protocolFee + result.referralFee

    const { partnerFee, creatorFee } = this.splitPartnerAndCreatorFee(result.tradingFee)

    let next: PoolState = {
      ...state,
      sqrtPrice: result.nextSqrtPrice,
      hasSwap: true,
    }

    if (feeMode.feesOnBaseToken) {
      next = {
        ...next,
        partnerBaseFee: next.partnerBaseFee + partnerFee,
        protocolBaseFee: next.protocolBaseFee + result.protocolFee,
        creatorBaseFee: next.creatorBaseFee + creatorFee,
      }
    } else {
      next = {
        ...next,
        partnerQuoteFee: next.partnerQuoteFee + partnerFee,
        protocolQuoteFee: next.protocolQuoteFee + result.protocolFee,
        creatorQuoteFee: next.creatorQuoteFee + creatorFee,
      }
    }

    if (tradeDirection === TradeDirection.BaseToQuote) {
      next = {
        ...next,
        baseReserve: next.baseReserve + actualInputAmount,
        quoteReserve: safeSub(next.quoteReserve, actualOutputAmount, 'quoteReserve'),
      }
    } else {
      next = {
        ...next,
        quoteReserve: next.quoteReserve + actualInputAmount,
        baseReserve: safeSub(next.baseReserve, actualOutputAmount, 'baseReserve'),
      }
    }

    return {
      ...next,
      volatilityTracker: this.updatePostSwap(
        next.volatilityTracker,
        oldSqrtPrice,
        result.nextSqrtPrice,
        currentTimestamp,
      ),
    }
  }

  /** `PoolConfig::split_partner_and_creator_fee`. */
  private splitPartnerAndCreatorFee(fee: bigint): { partnerFee: bigint; creatorFee: bigint } {
    const creatorPercentage = BigInt(this.config.creatorTradingFeePercentage)
    if (creatorPercentage === 0n) return { partnerFee: fee, creatorFee: 0n }
    const creatorFee = (fee * creatorPercentage) / 100n
    return { partnerFee: fee - creatorFee, creatorFee }
  }

  /**
   * The point the fee scheduler measures against, given a clock reading.
   * Which one is correct depends on the config, and getting it wrong changes
   * every fee a launch charges.
   */
  static currentPoint(
    config: EngineConfig,
    clock: { slot: bigint; unixTimestamp: bigint },
  ): bigint {
    return config.activationType === ActivationType.Slot ? clock.slot : clock.unixTimestamp
  }
}
