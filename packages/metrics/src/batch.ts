import type { Concentration } from './concentration.js'
import type { FeeAmounts } from './report.js'

/** The part of one launch scorecard that is meaningful across seeds. */
export interface BatchScorecard {
  readonly graduated: boolean
  readonly timeToGraduationSeconds: bigint | null
  readonly concentration: Pick<
    Concentration,
    'sniperShare' | 'topHolderShare' | 'topFiveShare' | 'topTenShare'
  >
  /** Native atomic units; base and quote remain separate. */
  readonly feesToCreator: FeeAmounts
  readonly averageSlippage: number
  readonly worstSlippage: number
}

/** Mean and interpolation-based percentile summary for one metric. */
export interface Distribution {
  readonly mean: number
  readonly median: number
  readonly p5: number
  readonly p95: number
}

export interface GraduationBatchReport {
  readonly probability: number
  readonly graduatedRuns: number
  readonly timeToGraduationSeconds: Distribution | null
}

/** A batch keeps its raw scorecards alongside their summaries. */
export interface BatchReport {
  readonly runs: readonly BatchScorecard[]
  readonly sniperCapture: Distribution
  readonly concentration: {
    readonly topHolderShare: Distribution
    readonly topFiveShare: Distribution
    readonly topTenShare: Distribution
  }
  readonly creatorRevenue: {
    readonly quote: Distribution
    readonly base: Distribution
  }
  readonly slippage: {
    readonly average: Distribution
    readonly worst: Distribution
  }
  readonly graduation: GraduationBatchReport
}

/**
 * Aggregate single-run scorecards without reimplementing any single-run math.
 *
 * Percentiles use linear interpolation between sorted observations: for five
 * values 1..5, p5 is 1.2 and p95 is 4.8.
 */
export function aggregateBatch(runs: readonly BatchScorecard[]): BatchReport {
  if (runs.length === 0) throw new Error('A batch report needs at least one run')

  const report: Omit<BatchReport, 'graduation'> = {
    runs,
    sniperCapture: distribution(runs.map((run) => run.concentration.sniperShare)),
    concentration: {
      topHolderShare: distribution(runs.map((run) => run.concentration.topHolderShare)),
      topFiveShare: distribution(runs.map((run) => run.concentration.topFiveShare)),
      topTenShare: distribution(runs.map((run) => run.concentration.topTenShare)),
    },
    creatorRevenue: {
      quote: distribution(runs.map((run) => Number(run.feesToCreator.quote))),
      base: distribution(runs.map((run) => Number(run.feesToCreator.base))),
    },
    slippage: {
      average: distribution(runs.map((run) => run.averageSlippage)),
      worst: distribution(runs.map((run) => run.worstSlippage)),
    },
  }

  return { ...report, graduation: graduationFromBatch(report) }
}

/** Calculate graduation probability and time distribution from raw batch runs. */
export function graduationFromBatch(batch: Pick<BatchReport, 'runs'>): GraduationBatchReport {
  const graduated = batch.runs.filter((run) => run.graduated)
  const times = graduated
    .map((run) => run.timeToGraduationSeconds)
    .filter((time): time is bigint => time !== null)
    .map(Number)

  return {
    probability: graduated.length / batch.runs.length,
    graduatedRuns: graduated.length,
    timeToGraduationSeconds: times.length > 0 ? distribution(times) : null,
  }
}

export function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) throw new Error('A distribution needs at least one value')
  const sorted = [...values].sort((a, b) => a - b)
  return {
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    median: percentile(sorted, 0.5),
    p5: percentile(sorted, 0.05),
    p95: percentile(sorted, 0.95),
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const remainder = index - lower
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * remainder
}
