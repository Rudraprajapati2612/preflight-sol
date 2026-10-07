import { describe, expect, it } from 'vitest'

import { aggregateBatch, graduationFromBatch, type BatchScorecard } from '../src/index.js'

const runs: BatchScorecard[] = [
  score(0, false, null, 10),
  score(0.1, true, 10n, 20),
  score(0.2, true, 20n, 30),
  score(0.3, false, null, 40),
  score(0.4, true, 30n, 50),
]

function score(
  sniperShare: number,
  graduated: boolean,
  timeToGraduationSeconds: bigint | null,
  creatorQuote: number,
): BatchScorecard {
  return {
    graduated,
    timeToGraduationSeconds,
    concentration: {
      sniperShare,
      topHolderShare: sniperShare + 0.2,
      topFiveShare: sniperShare + 0.4,
      topTenShare: sniperShare + 0.5,
    },
    feesToCreator: { quote: BigInt(creatorQuote), base: BigInt(creatorQuote * 2) },
    averageSlippage: sniperShare / 10,
    worstSlippage: sniperShare / 5,
  }
}

describe('aggregateBatch', () => {
  it('calculates hand-checkable mean, median, and percentile summaries', () => {
    const report = aggregateBatch(runs)

    expect(report.sniperCapture.mean).toBeCloseTo(0.2, 12)
    expect(report.sniperCapture.median).toBeCloseTo(0.2, 12)
    expect(report.sniperCapture.p5).toBeCloseTo(0.02, 12)
    expect(report.sniperCapture.p95).toBeCloseTo(0.38, 12)
    expect(report.creatorRevenue.quote).toEqual({ mean: 30, median: 30, p5: 12, p95: 48 })
    expect(report.creatorRevenue.base).toEqual({ mean: 60, median: 60, p5: 24, p95: 96 })
    expect(report.concentration.topHolderShare.mean).toBeCloseTo(0.4, 12)
    expect(report.slippage.average.median).toBeCloseTo(0.02, 12)
  })

  it('reports graduation probability and times only from graduated runs', () => {
    const report = aggregateBatch(runs)

    expect(report.graduation).toEqual({
      probability: 0.6,
      graduatedRuns: 3,
      timeToGraduationSeconds: { mean: 20, median: 20, p5: 11, p95: 29 },
    })
    expect(graduationFromBatch(report)).toEqual(report.graduation)
  })

  it('rejects an empty batch instead of reporting a plausible zero', () => {
    expect(() => aggregateBatch([])).toThrow(/at least one run/i)
  })
})
