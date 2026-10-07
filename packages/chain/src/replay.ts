import {
  type EngineConfig,
  openingBaseReserve,
  type PoolState,
  TradeDirection,
  VirtualPool,
} from '@preflight/core'

import { type RecordedSwap, SwapMode } from './history.js'

/**
 * Replaying a launch that already happened.
 *
 * This is the strongest check the project has, and it costs nothing to run: the
 * program recorded its own answer for every swap it ever executed, so feeding
 * the same inputs through the engine and comparing is a correctness test made
 * of other people's real trades rather than of cases someone thought to write.
 *
 * The comparison is exact. A simulator that is approximately right about a fee
 * is not a simulator anyone should size a launch with.
 */

/**
 * How the recorded swap should be replayed.
 *
 * A swap that left input unconsumed was a partial fill whatever it was labelled,
 * and one that consumed everything behaves the same under either input mode.
 */
function modeOf(swap: RecordedSwap): 'exactIn' | 'partialFill' | 'exactOut' {
  if (swap.swapMode === SwapMode.ExactOut) return 'exactOut'
  if (swap.swapMode === SwapMode.PartialFill || swap.result.amountLeft > 0n) return 'partialFill'
  return 'exactIn'
}

/** Fields compared on every swap. Named so a divergence says what diverged. */
const COMPARED = [
  'includedFeeInputAmount',
  'excludedFeeInputAmount',
  'amountLeft',
  'outputAmount',
  'nextSqrtPrice',
  'tradingFee',
  'protocolFee',
  'referralFee',
] as const

export interface Divergence {
  readonly step: number
  readonly signature: string
  readonly field: (typeof COMPARED)[number] | 'quoteReserve' | 'error'
  readonly expected: string
  readonly actual: string
}

export interface ReplayReport {
  readonly pool: string
  readonly swapsReplayed: number
  /**
   * Swaps the engine cannot yet reproduce, and why.
   *
   * Counted rather than quietly skipped: a replay that omits the trades it
   * cannot handle and then reports no divergences is worse than one that
   * fails, because it reads as a pass.
   */
  readonly unsupported: readonly { step: number; signature: string; reason: string }[]
  readonly fieldsCompared: number
  readonly divergences: readonly Divergence[]
  /** True when every recorded field was reproduced exactly. */
  readonly exact: boolean
  readonly finalState: PoolState
}

/** The state a pool is in before anyone has traded on it. */
export function openingState(config: EngineConfig, activationPoint: bigint): PoolState {
  return {
    sqrtPrice: config.sqrtStartPrice,
    // What the program would actually put in the vault: everything the curve
    // has to sell, plus what is held back to seed the pool at graduation.
    baseReserve: openingBaseReserve(config),
    quoteReserve: 0n,
    protocolBaseFee: 0n,
    protocolQuoteFee: 0n,
    partnerBaseFee: 0n,
    partnerQuoteFee: 0n,
    creatorBaseFee: 0n,
    creatorQuoteFee: 0n,
    activationPoint,
    volatilityTracker: {
      lastUpdateTimestamp: 0n,
      sqrtPriceReference: config.sqrtStartPrice,
      volatilityAccumulator: 0n,
      volatilityReference: 0n,
    },
    hasSwap: false,
  }
}

/**
 * Replay a recorded launch through the engine.
 *
 * Each swap is executed with the amount and the clock the chain recorded, and
 * the result compared field by field against what the program produced at the
 * time. Because every swap starts from the state the previous one left, a
 * divergence anywhere shows up here and does not average out.
 */
export function replayLaunch(
  pool: string,
  config: EngineConfig,
  swaps: readonly RecordedSwap[],
  options: { activationPoint?: bigint } = {},
): ReplayReport {
  const activation = options.activationPoint ?? swaps[0]?.currentTimestamp ?? 0n
  const engine = new VirtualPool(config, openingState(config, activation))
  const divergences: Divergence[] = []
  const unsupported: { step: number; signature: string; reason: string }[] = []
  let fieldsCompared = 0
  let replayed = 0

  for (const [index, swap] of swaps.entries()) {
    const clock = { slot: BigInt(swap.slot), unixTimestamp: swap.currentTimestamp }
    const direction =
      swap.tradeDirection === 0 ? TradeDirection.BaseToQuote : TradeDirection.QuoteToBase

    let actual
    try {
      actual = engine.swap(swap.amount0, direction, {
        currentPoint: VirtualPool.currentPoint(config, clock),
        currentTimestamp: swap.currentTimestamp,
        // `amount0` is an input under the first two modes and an output under
        // the third, so the mode has to travel with it.
        mode: modeOf(swap),
      }).result
    } catch (error) {
      divergences.push({
        step: index,
        signature: swap.signature,
        field: 'error',
        expected: `a swap producing ${swap.result.outputAmount}`,
        actual: error instanceof Error ? error.message : String(error),
      })
      break
    }

    for (const field of COMPARED) {
      fieldsCompared++
      if (actual[field] !== swap.result[field]) {
        divergences.push({
          step: index,
          signature: swap.signature,
          field,
          expected: swap.result[field].toString(),
          actual: actual[field].toString(),
        })
      }
    }

    replayed++

    // The program reports the quote reserve it holds after the swap, which
    // catches an engine that prices each trade correctly while losing track of
    // the running total.
    fieldsCompared++
    if (engine.state.quoteReserve !== swap.quoteReserveAmount) {
      divergences.push({
        step: index,
        signature: swap.signature,
        field: 'quoteReserve',
        expected: swap.quoteReserveAmount.toString(),
        actual: engine.state.quoteReserve.toString(),
      })
    }
  }

  return {
    pool,
    swapsReplayed: replayed,
    unsupported,
    fieldsCompared,
    divergences,
    // Unsupported trades do not count as agreement. A replay that stopped
    // early has not shown the engine matches the rest of the launch.
    exact: divergences.length === 0 && unsupported.length === 0,
    finalState: engine.state,
  }
}
