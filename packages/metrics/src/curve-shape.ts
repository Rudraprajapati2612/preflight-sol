import type { EngineConfig } from '@preflight/core'

import { priceFromSqrtPrice } from './price.js'

/**
 * The shape of the curve itself, before anyone trades on it.
 *
 * This is the thing a launcher is actually choosing when they configure a DBC,
 * and it is invisible in the configuration: a list of square-root prices and
 * thirty-digit liquidity values says nothing about whether the price doubles in
 * the first 10% of the raise or the last.
 *
 * Computed from the segment math rather than by simulating trades, so it is the
 * curve as designed — no fees, no ordering, no agents. What a trade actually
 * costs is a separate question, and conflating the two hides which of the
 * config's decisions is responsible for what.
 */

export interface CurvePoint {
  /** Quote raised to reach this point, in atomic units. */
  readonly quoteRaised: bigint
  /** Base tokens sold to reach it, in atomic units. */
  readonly baseSold: bigint
  /** Price per whole base token, in whole quote tokens. */
  readonly price: number
  /** Fraction of the way to graduation, 0 to 1. */
  readonly progress: number
}

/**
 * Walk the curve from its start price to the point where it graduates.
 *
 * Between two square-root prices within one segment the program uses
 * `Δquote = L·(√P_hi − √P_lo) >> 128` and
 * `Δbase = L·(√P_hi − √P_lo) / (√P_lo·√P_hi)`. Sampling inside each segment and
 * accumulating gives the same path a buyer would walk.
 */
export function curveShape(
  config: EngineConfig,
  baseDecimals: number,
  quoteDecimals: number,
  samples = 80,
): CurvePoint[] {
  const segments = config.curve.filter((point) => point.sqrtPrice > 0n && point.liquidity > 0n)
  if (segments.length === 0) return []

  const stop = config.migrationSqrtPrice
  const points: CurvePoint[] = []
  let quoteRaised = 0n
  let baseSold = 0n
  let lower = config.sqrtStartPrice

  const push = (sqrtPrice: bigint): void => {
    points.push({
      quoteRaised,
      baseSold,
      price: priceFromSqrtPrice(sqrtPrice, baseDecimals, quoteDecimals),
      progress: 0,
    })
  }
  push(lower)

  for (const segment of segments) {
    if (lower >= stop) break
    const upper = segment.sqrtPrice < stop ? segment.sqrtPrice : stop
    if (upper <= lower) continue

    // Sample within the segment so a curve with two long segments still reads
    // as a curve rather than as two straight lines.
    const steps = BigInt(Math.max(2, Math.round(samples / segments.length)))
    const span = upper - lower
    let cursor = lower

    for (let i = 1n; i <= steps; i++) {
      const next = i === steps ? upper : lower + (span * i) / steps
      if (next <= cursor) continue
      quoteRaised += (segment.liquidity * (next - cursor)) >> 128n
      baseSold += (segment.liquidity * (next - cursor)) / (cursor * next)
      cursor = next
      push(cursor)
    }
    lower = upper
  }

  const total = points.at(-1)?.quoteRaised ?? 0n
  if (total === 0n) return points
  return points.map((point) => ({
    ...point,
    progress: Number((point.quoteRaised * 10_000n) / total) / 10_000,
  }))
}
