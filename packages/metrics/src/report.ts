import type { Trace, TraceStep } from '@preflight/agents'
import type { QuoteAsset } from '@preflight/config'
import { type EngineConfig, TradeDirection } from '@preflight/core'

import { concentration, type Concentration } from './concentration.js'
import { priceFromSqrtPrice, ratio } from './price.js'

/**
 * What a simulated launch actually tells you.
 *
 * The figures here are chosen to answer the questions a launcher asks when
 * choosing between two curves: did it graduate and how long did it take, who
 * ended up holding the token, what did trading it cost, and how violent was
 * the ride.
 */

export interface Candle {
  readonly timestamp: bigint
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  /** Quote volume in the bucket, in atomic units. */
  readonly volume: bigint
}

export interface LaunchReport {
  readonly seed: string
  readonly quoteSymbol: string

  readonly graduated: boolean
  /** Seconds from the first trade to graduation, when it happened. */
  readonly timeToGraduationSeconds: bigint | null
  readonly trades: number
  readonly buys: number
  readonly sells: number

  readonly openingPrice: number
  readonly closingPrice: number
  readonly peakPrice: number
  readonly priceMultiple: number

  /** Quote that changed hands, in atomic units. */
  readonly quoteVolume: bigint
  /** Quote that reached the curve rather than being paid as a fee. */
  readonly quoteRaised: bigint

  readonly feesToProtocol: bigint
  readonly feesToPartner: bigint
  readonly feesToCreator: bigint
  readonly feesTotal: bigint

  readonly concentration: Concentration

  /**
   * Standard deviation of log returns between consecutive trades. Unitless,
   * and deliberately not annualised: a launch lasts minutes, so scaling it to
   * a year would be a number with no meaning attached.
   */
  readonly volatility: number

  /**
   * Average gap between the price a trade paid and the price showing before it
   * traded, as a fraction. This is what a curve costs its users.
   */
  readonly averageSlippage: number
  readonly worstSlippage: number

  readonly candles: readonly Candle[]
}

export interface ReportInput {
  readonly trace: Trace
  readonly config: EngineConfig
  readonly baseDecimals: number
  readonly quoteAsset: QuoteAsset
  /** Candle width in seconds. */
  readonly bucketSeconds?: bigint
}

export function buildReport(input: ReportInput): LaunchReport {
  const { trace, baseDecimals, quoteAsset } = input
  const quoteDecimals = quoteAsset.decimals
  const priceAt = (sqrtPrice: bigint): number =>
    priceFromSqrtPrice(sqrtPrice, baseDecimals, quoteDecimals)

  const steps = trace.steps
  const buys = steps.filter((step) => step.direction === TradeDirection.QuoteToBase)
  const sells = steps.filter((step) => step.direction === TradeDirection.BaseToQuote)

  const prices = steps.map((step) => priceAt(step.poolAfter.sqrtPrice))
  const openingPrice = steps.length > 0 ? priceAt(steps[0]!.poolAfter.sqrtPrice) : 0
  const closingPrice = priceAt(trace.finalPool.sqrtPrice)
  const peakPrice = prices.length > 0 ? Math.max(...prices) : 0

  // Quote volume counts what traders actually paid or received in quote.
  const quoteVolume = steps.reduce(
    (total, step) =>
      total +
      (step.direction === TradeDirection.QuoteToBase
        ? step.result.includedFeeInputAmount
        : step.result.outputAmount),
    0n,
  )

  const finalPool = trace.finalPool
  const feesToProtocol = finalPool.protocolQuoteFee + finalPool.protocolBaseFee
  const feesToPartner = finalPool.partnerQuoteFee + finalPool.partnerBaseFee
  const feesToCreator = finalPool.creatorQuoteFee + finalPool.creatorBaseFee

  const firstTradeAt = steps[0]?.clock.unixTimestamp
  const graduationAt = trace.curveCompleted ? steps.at(-1)?.clock.unixTimestamp : undefined

  return {
    seed: trace.seed,
    quoteSymbol: quoteAsset.symbol,
    graduated: trace.curveCompleted,
    timeToGraduationSeconds:
      graduationAt !== undefined && firstTradeAt !== undefined ? graduationAt - firstTradeAt : null,
    trades: steps.length,
    buys: buys.length,
    sells: sells.length,
    openingPrice,
    closingPrice,
    peakPrice,
    priceMultiple: openingPrice > 0 ? closingPrice / openingPrice : 0,
    quoteVolume,
    quoteRaised: finalPool.quoteReserve,
    feesToProtocol,
    feesToPartner,
    feesToCreator,
    feesTotal: feesToProtocol + feesToPartner + feesToCreator,
    concentration: concentration(trace.agents),
    volatility: volatilityOf(prices),
    ...slippageOf(steps, priceAt, baseDecimals, quoteDecimals),
    candles: candlesOf(steps, priceAt, input.bucketSeconds ?? 30n),
  }
}

/** Standard deviation of log returns; zero when there is nothing to compare. */
function volatilityOf(prices: readonly number[]): number {
  const returns: number[] = []
  for (let i = 1; i < prices.length; i++) {
    const previous = prices[i - 1]!
    const current = prices[i]!
    if (previous > 0 && current > 0) returns.push(Math.log(current / previous))
  }
  if (returns.length < 2) return 0

  const mean = returns.reduce((total, value) => total + value, 0) / returns.length
  const variance =
    returns.reduce((total, value) => total + (value - mean) ** 2, 0) / (returns.length - 1)
  return Math.sqrt(variance)
}

/**
 * How far each trade's realised price sat from the price showing beforehand.
 *
 * Computed from the exact amounts that changed hands rather than from a
 * displayed price, so it reflects what the trader actually got, fee included.
 *
 * Both sides have to be in the same units. The amounts are atomic and the two
 * tokens rarely share a precision, so the ratio is scaled by the decimal
 * difference before being compared against a price per whole token. Skipping
 * that compares quote-per-atomic with quote-per-token and reports slippage in
 * the tens of thousands of percent — wrong to any reader, but a perfectly
 * finite number, so a checks-for-NaN test sails past it.
 */
function slippageOf(
  steps: readonly TraceStep[],
  priceAt: (sqrtPrice: bigint) => number,
  baseDecimals: number,
  quoteDecimals: number,
): { averageSlippage: number; worstSlippage: number } {
  const slippages: number[] = []
  const baseScale = 10n ** BigInt(baseDecimals)
  const quoteScale = 10n ** BigInt(quoteDecimals)

  for (const step of steps) {
    const spot = priceAt(step.poolAfter.sqrtPrice)
    if (spot <= 0) continue

    const paid = step.result.includedFeeInputAmount
    const received = step.result.outputAmount
    if (paid === 0n || received === 0n) continue

    // Quote per whole base token, however the trade was oriented.
    const [quoteAmount, baseAmount] =
      step.direction === TradeDirection.QuoteToBase ? [paid, received] : [received, paid]
    const effective = ratio(quoteAmount * baseScale, baseAmount * quoteScale)
    if (effective <= 0) continue

    slippages.push(Math.abs(effective - spot) / spot)
  }

  if (slippages.length === 0) return { averageSlippage: 0, worstSlippage: 0 }
  return {
    averageSlippage: slippages.reduce((total, value) => total + value, 0) / slippages.length,
    worstSlippage: Math.max(...slippages),
  }
}

/** Price candles, bucketed by wall-clock time. */
function candlesOf(
  steps: readonly TraceStep[],
  priceAt: (sqrtPrice: bigint) => number,
  bucketSeconds: bigint,
): Candle[] {
  if (steps.length === 0) return []

  const start = steps[0]!.clock.unixTimestamp
  const buckets = new Map<bigint, TraceStep[]>()

  for (const step of steps) {
    const bucket = start + ((step.clock.unixTimestamp - start) / bucketSeconds) * bucketSeconds
    const existing = buckets.get(bucket)
    if (existing) existing.push(step)
    else buckets.set(bucket, [step])
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a === b ? 0 : a > b ? 1 : -1))
    .map(([timestamp, bucketSteps]) => {
      const prices = bucketSteps.map((step) => priceAt(step.poolAfter.sqrtPrice))
      return {
        timestamp,
        open: prices[0]!,
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: prices.at(-1)!,
        volume: bucketSteps.reduce(
          (total, step) =>
            total +
            (step.direction === TradeDirection.QuoteToBase
              ? step.result.includedFeeInputAmount
              : step.result.outputAmount),
          0n,
        ),
      }
    })
}
