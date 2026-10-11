/**
 * @preflight/tuner — bounded, reproducible configuration search.
 *
 * The tuner deliberately owns no simulation or metric arithmetic. It changes
 * a small, documented set of launch parameters, then delegates execution to
 * @preflight/agents and aggregation to @preflight/metrics.
 */

import type { ConfigParameters } from '@meteora-ag/dynamic-bonding-curve-sdk'
import BN from 'bn.js'
import {
  runMonteCarlo,
  type ClockReading,
  type MonteCarloBatch,
  type MonteCarloRun,
  type ScenarioParticipant,
} from '@preflight/agents'
import {
  engineConfigFromParams,
  type QuoteAsset,
  type ValidationResult,
  validateLaunchConfig,
} from '@preflight/config'
import { openingBaseReserve, type EngineConfig, type PoolState } from '@preflight/core'
import {
  aggregateBatch,
  buildReport,
  type BatchReport,
  type BatchScorecard,
} from '@preflight/metrics'

/** The only knobs this first tuner can safely alter on an already-built curve. */
export const TUNABLE_PARAMETERS = ['startingFeeBps', 'creatorTradingFeePercentage'] as const
export type TunableParameter = (typeof TUNABLE_PARAMETERS)[number]

export type TuningObjective =
  | { readonly kind: 'maximize-graduation-probability' }
  | { readonly kind: 'minimize-sniper-capture' }
  | { readonly kind: 'minimize-top-ten-concentration' }
  | { readonly kind: 'maximize-creator-revenue' }
  | { readonly kind: 'minimize-average-slippage' }
  | { readonly kind: 'minimize-worst-slippage' }
  | { readonly kind: 'weighted'; readonly weights: Partial<Record<TuningMetric, number>> }

export type TuningMetric =
  | 'graduationProbability'
  | 'sniperCapture'
  | 'topTenConcentration'
  | 'creatorRevenueQuote'
  | 'averageSlippage'
  | 'worstSlippage'

export interface TuningConstraints {
  readonly minimumGraduationProbability?: number
  readonly maximumSniperCapture?: number
  readonly maximumTopTenConcentration?: number
  readonly maximumAverageSlippage?: number
  readonly maximumWorstSlippage?: number
}

export interface TuningInput {
  /** The complete, SDK-shaped configuration used as the comparison point. */
  readonly baseline: ConfigParameters
  /** A non-empty grid for one or both supported knobs. */
  readonly searchSpace: Partial<Record<TunableParameter, readonly number[]>>
  readonly baseSeed: string
  readonly runs: number
  readonly objective: TuningObjective
  readonly participants: readonly ScenarioParticipant[]
  readonly quoteAsset: QuoteAsset
  readonly baseDecimals: number
  readonly constraints?: TuningConstraints
  readonly start?: ClockReading
  readonly maxSteps?: number
  /** Includes the baseline. Defaults to 64. */
  readonly maxCandidates?: number
  /** Candidate simulations, including baseline simulations. Defaults to 512. */
  readonly maxEvaluations?: number
}

export interface CandidateScore {
  readonly graduationProbability: number
  readonly sniperCapture: number
  readonly topTenConcentration: number
  readonly creatorRevenueQuote: number
  readonly averageSlippage: number
  readonly worstSlippage: number
}

export interface ConstraintStatus {
  readonly feasible: boolean
  readonly violations: readonly string[]
}

export interface TuningCandidate {
  readonly id: string
  readonly isBaseline: boolean
  readonly parameters: Readonly<Record<TunableParameter, number>>
  readonly config: ConfigParameters
  readonly validation: ValidationResult
  readonly scorecard: BatchReport | null
  /** Seeded traces and their per-run scorecards, retained for inspection. */
  readonly rawRuns: readonly MonteCarloRun<BatchScorecard>[]
  readonly score: CandidateScore | null
  readonly objectiveValue: number | null
  readonly constraints: ConstraintStatus
  /** One-based among feasible candidates; null for invalid/infeasible ones. */
  readonly rank: number | null
  readonly tieBreak: string
}

export interface TuningReport {
  readonly baseline: TuningCandidate
  readonly candidates: readonly TuningCandidate[]
  readonly recommended: TuningCandidate | null
  readonly explanation: string
  readonly objective: TuningObjective
  readonly constraints: TuningConstraints
  readonly baseSeed: string
  readonly runsPerCandidate: number
  readonly candidateCount: number
  readonly simulationRunsEvaluated: number
  readonly seedSet: readonly string[]
}

const DEFAULT_MAX_CANDIDATES = 64
const DEFAULT_MAX_EVALUATIONS = 512

/** Generate the baseline plus a deduplicated Cartesian grid, without running it. */
export function generateCandidates(
  baseline: ConfigParameters,
  searchSpace: TuningInput['searchSpace'],
  maxCandidates = DEFAULT_MAX_CANDIDATES,
): readonly {
  readonly config: ConfigParameters
  readonly isBaseline: boolean
  readonly parameters: Readonly<Record<TunableParameter, number>>
  readonly id: string
}[] {
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) {
    throw new Error('maxCandidates must be a positive integer')
  }
  const keys = TUNABLE_PARAMETERS.filter((key) => searchSpace[key] !== undefined)
  if (keys.length === 0)
    throw new Error('Search space must select at least one supported parameter')
  for (const key of keys) {
    const values = searchSpace[key]!
    if (values.length === 0) throw new Error(`Search space for ${key} must not be empty`)
    if (values.some((value) => !Number.isFinite(value))) {
      throw new Error(`Search space for ${key} contains a non-finite value`)
    }
    if (values.some((value) => !Number.isInteger(value))) {
      throw new Error(`Search space for ${key} must contain whole numbers`)
    }
  }

  const combinations: Partial<Record<TunableParameter, number>>[] = [{}]
  for (const key of keys) {
    const values = [...new Set(searchSpace[key]!)]
    combinations.splice(
      0,
      combinations.length,
      ...combinations.flatMap((partial) => values.map((value) => ({ ...partial, [key]: value }))),
    )
  }

  const all = [
    snapshot(baseline),
    ...combinations.map((values) => ({ ...snapshot(baseline), ...values })),
  ]
  const unique = new Map<string, Readonly<Record<TunableParameter, number>>>()
  for (const values of all) unique.set(candidateKey(values), values)
  if (unique.size > maxCandidates) {
    throw new Error(
      `Search generated ${unique.size} candidates, above the maximum of ${maxCandidates}`,
    )
  }

  const baselineKey = candidateKey(snapshot(baseline))
  return [...unique.entries()].map(([id, parameters]) => ({
    id,
    parameters,
    isBaseline: id === baselineKey,
    // Retain the caller's baseline exactly. Its fee numerator need not be an
    // exact bps multiple, so rebuilding it from the display value could alter
    // the comparison point.
    config: id === baselineKey ? baseline : applyParameters(baseline, parameters),
  }))
}

/** Evaluate every valid candidate with exactly the same derived Monte Carlo seed set. */
export function tuneLaunch(input: TuningInput): TuningReport {
  if (!Number.isInteger(input.runs) || input.runs <= 0) {
    throw new Error('Monte Carlo runs must be a positive integer')
  }
  validateObjective(input.objective)
  const constraints = input.constraints ?? {}
  validateConstraints(constraints)
  const candidates = generateCandidates(input.baseline, input.searchSpace, input.maxCandidates)
  const maxEvaluations = input.maxEvaluations ?? DEFAULT_MAX_EVALUATIONS
  if (!Number.isInteger(maxEvaluations) || maxEvaluations < 1) {
    throw new Error('maxEvaluations must be a positive integer')
  }
  const evaluations = candidates.length * input.runs
  if (evaluations > maxEvaluations) {
    throw new Error(
      `Tuning needs ${evaluations} simulations, above the evaluation budget of ${maxEvaluations}`,
    )
  }

  const evaluated = candidates.map((candidate) => evaluateCandidate(candidate, input, constraints))
  const scored = assignRanks(evaluated, input.objective)
  const baseline = scored.find((candidate) => candidate.isBaseline)!
  const recommended = scored.find((candidate) => candidate.rank === 1) ?? null
  const seedSet = Array.from({ length: input.runs }, (_, index) => `${input.baseSeed}:${index}`)

  return {
    baseline,
    candidates: scored,
    recommended,
    explanation: explainRecommendation(baseline, recommended, input.objective),
    objective: input.objective,
    constraints,
    baseSeed: input.baseSeed,
    runsPerCandidate: input.runs,
    candidateCount: scored.length,
    simulationRunsEvaluated:
      evaluated.filter((candidate) => candidate.scorecard !== null).length * input.runs,
    seedSet,
  }
}

/** Score and rank already-aggregated synthetic candidates; useful for UI previews and tests. */
export function rankCandidates(
  candidates: readonly Pick<TuningCandidate, 'id' | 'scorecard' | 'validation' | 'constraints'>[],
  objective: TuningObjective,
): readonly {
  readonly id: string
  readonly objectiveValue: number | null
  readonly rank: number | null
}[] {
  const eligible = candidates
    .filter(
      (candidate) =>
        candidate.validation.valid && candidate.constraints.feasible && candidate.scorecard,
    )
    .map((candidate) => ({ id: candidate.id, score: scoreOf(candidate.scorecard!), candidate }))
  const values = objectiveValues(
    eligible.map((candidate) => candidate.score),
    objective,
  )
  const ranked = eligible
    .map((candidate, index) => ({ ...candidate, objectiveValue: values[index]! }))
    .sort((a, b) => b.objectiveValue - a.objectiveValue || a.id.localeCompare(b.id))
  const ranks = new Map(
    ranked.map((candidate, index) => [
      candidate.id,
      { objectiveValue: candidate.objectiveValue, rank: index + 1 },
    ]),
  )
  return candidates.map((candidate) => ({
    id: candidate.id,
    ...(ranks.get(candidate.id) ?? { objectiveValue: null, rank: null }),
  }))
}

function evaluateCandidate(
  candidate: ReturnType<typeof generateCandidates>[number],
  input: TuningInput,
  constraints: TuningConstraints,
): TuningCandidate {
  const validation = validateLaunchConfig(candidate.config, input.quoteAsset)
  if (!validation.valid) {
    return invalidCandidate(candidate, validation)
  }
  const config = engineConfigFromParams(candidate.config)
  const batch: MonteCarloBatch<BatchScorecard> = runMonteCarlo({
    baseSeed: input.baseSeed,
    runs: input.runs,
    config,
    initialPool: openingPool(config, input.start),
    participants: input.participants,
    ...(input.start === undefined ? {} : { start: input.start }),
    ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
    scorecard: (trace) =>
      buildReport({
        trace,
        config,
        baseDecimals: input.baseDecimals,
        quoteAsset: input.quoteAsset,
      }),
  })
  const scorecard = aggregateBatch(batch.runs.map((run) => run.scorecard))
  const score = scoreOf(scorecard)
  return {
    ...candidate,
    validation,
    scorecard,
    rawRuns: batch.runs,
    score,
    objectiveValue: null,
    constraints: constraintsOf(score, constraints),
    rank: null,
    tieBreak: candidate.id,
  }
}

function invalidCandidate(
  candidate: ReturnType<typeof generateCandidates>[number],
  validation: ValidationResult,
): TuningCandidate {
  return {
    ...candidate,
    validation,
    scorecard: null,
    rawRuns: [],
    score: null,
    objectiveValue: null,
    constraints: { feasible: false, violations: ['configuration is invalid'] },
    rank: null,
    tieBreak: candidate.id,
  }
}

function assignRanks(
  candidates: readonly TuningCandidate[],
  objective: TuningObjective,
): readonly TuningCandidate[] {
  const ranking = rankCandidates(candidates, objective)
  const byId = new Map(ranking.map((result) => [result.id, result]))
  return candidates
    .map((candidate) => ({ ...candidate, ...byId.get(candidate.id)! }))
    .sort(
      (a, b) =>
        (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    )
}

function objectiveValues(
  scores: readonly CandidateScore[],
  objective: TuningObjective,
): readonly number[] {
  if (objective.kind !== 'weighted') {
    const metric = metricForObjective(objective.kind)
    const direction = isHigherBetter(metric) ? 1 : -1
    return scores.map((score) => direction * score[metric])
  }
  const weights = Object.entries(objective.weights).filter(
    (entry): entry is [TuningMetric, number] => Number.isFinite(entry[1]) && entry[1] > 0,
  )
  if (weights.length === 0)
    throw new Error('Weighted objective needs at least one positive finite weight')
  const totalWeight = weights.reduce((total, [, weight]) => total + weight, 0)
  return scores.map((score) =>
    weights.reduce((total, [metric, weight]) => {
      const values = scores.map((other) => other[metric])
      const low = Math.min(...values)
      const high = Math.max(...values)
      const normalized = high === low ? 1 : (score[metric] - low) / (high - low)
      return total + (isHigherBetter(metric) ? normalized : 1 - normalized) * (weight / totalWeight)
    }, 0),
  )
}

function metricForObjective(kind: Exclude<TuningObjective['kind'], 'weighted'>): TuningMetric {
  switch (kind) {
    case 'maximize-graduation-probability':
      return 'graduationProbability'
    case 'minimize-sniper-capture':
      return 'sniperCapture'
    case 'minimize-top-ten-concentration':
      return 'topTenConcentration'
    case 'maximize-creator-revenue':
      return 'creatorRevenueQuote'
    case 'minimize-average-slippage':
      return 'averageSlippage'
    case 'minimize-worst-slippage':
      return 'worstSlippage'
  }
}

function isHigherBetter(metric: TuningMetric): boolean {
  return metric === 'graduationProbability' || metric === 'creatorRevenueQuote'
}

function scoreOf(scorecard: BatchReport): CandidateScore {
  return {
    graduationProbability: scorecard.graduation.probability,
    sniperCapture: scorecard.sniperCapture.mean,
    topTenConcentration: scorecard.concentration.topTenShare.mean,
    creatorRevenueQuote: scorecard.creatorRevenue.quote.mean,
    averageSlippage: scorecard.slippage.average.mean,
    worstSlippage: scorecard.slippage.worst.mean,
  }
}

function constraintsOf(score: CandidateScore, constraints: TuningConstraints): ConstraintStatus {
  const violations: string[] = []
  if (
    constraints.minimumGraduationProbability !== undefined &&
    score.graduationProbability < constraints.minimumGraduationProbability
  )
    violations.push('graduation probability is below the minimum')
  if (
    constraints.maximumSniperCapture !== undefined &&
    score.sniperCapture > constraints.maximumSniperCapture
  )
    violations.push('sniper capture is above the maximum')
  if (
    constraints.maximumTopTenConcentration !== undefined &&
    score.topTenConcentration > constraints.maximumTopTenConcentration
  )
    violations.push('top-ten concentration is above the maximum')
  if (
    constraints.maximumAverageSlippage !== undefined &&
    score.averageSlippage > constraints.maximumAverageSlippage
  )
    violations.push('average slippage is above the maximum')
  if (
    constraints.maximumWorstSlippage !== undefined &&
    score.worstSlippage > constraints.maximumWorstSlippage
  )
    violations.push('worst slippage is above the maximum')
  return { feasible: violations.length === 0, violations }
}

function validateObjective(objective: TuningObjective): void {
  if (objective.kind !== 'weighted') return
  if (!Object.values(objective.weights).some((weight) => Number.isFinite(weight) && weight > 0)) {
    throw new Error('Weighted objective needs at least one positive finite weight')
  }
}

function validateConstraints(constraints: TuningConstraints): void {
  for (const [name, value] of Object.entries(constraints)) {
    if (!Number.isFinite(value)) throw new Error(`Constraint ${name} must be finite`)
    if (value! < 0 || value! > 1) throw new Error(`Constraint ${name} must be between 0 and 1`)
  }
}

function snapshot(config: ConfigParameters): Readonly<Record<TunableParameter, number>> {
  return {
    startingFeeBps: Number(BigInt(config.poolFees.baseFee.cliffFeeNumerator.toString()) / 100_000n),
    creatorTradingFeePercentage: config.creatorTradingFeePercentage,
  }
}

function candidateKey(parameters: Readonly<Record<TunableParameter, number>>): string {
  return TUNABLE_PARAMETERS.map((parameter) => `${parameter}=${parameters[parameter]}`).join('|')
}

function applyParameters(
  baseline: ConfigParameters,
  parameters: Readonly<Record<TunableParameter, number>>,
): ConfigParameters {
  return {
    ...baseline,
    poolFees: {
      ...baseline.poolFees,
      baseFee: {
        ...baseline.poolFees.baseFee,
        cliffFeeNumerator: new BN((BigInt(parameters.startingFeeBps) * 100_000n).toString()),
      },
    },
    creatorTradingFeePercentage: parameters.creatorTradingFeePercentage,
  }
}

function openingPool(config: EngineConfig, start?: ClockReading): PoolState {
  return {
    sqrtPrice: config.sqrtStartPrice,
    baseReserve: openingBaseReserve(config),
    quoteReserve: 0n,
    protocolBaseFee: 0n,
    protocolQuoteFee: 0n,
    partnerBaseFee: 0n,
    partnerQuoteFee: 0n,
    creatorBaseFee: 0n,
    creatorQuoteFee: 0n,
    activationPoint: start?.unixTimestamp ?? 1_767_225_600n,
    volatilityTracker: {
      lastUpdateTimestamp: 0n,
      sqrtPriceReference: config.sqrtStartPrice,
      volatilityAccumulator: 0n,
      volatilityReference: 0n,
    },
    hasSwap: false,
  }
}

function explainRecommendation(
  baseline: TuningCandidate,
  recommended: TuningCandidate | null,
  objective: TuningObjective,
): string {
  if (!recommended)
    return 'No feasible recommendation was found under the selected constraints and simulation assumptions.'
  if (recommended.isBaseline)
    return 'The baseline is the highest-ranked feasible candidate for the selected objective and simulation assumptions.'
  const value = recommended.objectiveValue!.toFixed(4)
  const baselineValue =
    baseline.objectiveValue === null ? 'infeasible' : baseline.objectiveValue.toFixed(4)
  return `Candidate ${recommended.id} ranks above the baseline for ${objective.kind} (objective ${value} versus ${baselineValue}). This is a simulation-based conditional recommendation, not a guarantee of launch success.`
}
