import type { EngineConfig, PoolState } from '@preflight/core'

import type { ClockReading } from './clock.js'
import { runScenario, type ScenarioParticipant } from './scheduler.js'
import type { Trace } from './types.js'

/** One reproducible simulation and the scorecard shaped from its trace. */
export interface MonteCarloRun<TScorecard> {
  readonly index: number
  readonly seed: string
  readonly trace: Trace
  readonly scorecard: TScorecard
}

/** The raw runs are kept so metrics can aggregate without losing evidence. */
export interface MonteCarloBatch<TScorecard> {
  readonly baseSeed: string
  readonly durationMs: number
  readonly runs: readonly MonteCarloRun<TScorecard>[]
}

export interface MonteCarloOptions<TScorecard> {
  readonly baseSeed: string
  readonly runs: number
  readonly config: EngineConfig
  readonly initialPool: PoolState
  readonly participants: readonly ScenarioParticipant[]
  readonly start?: ClockReading
  readonly maxSteps?: number
  /** Keeps agent simulation independent from whichever scorecard consumes it. */
  readonly scorecard: (trace: Trace) => TScorecard
}

/**
 * Repeat one configured crowd over deterministically derived seeds.
 *
 * The runner stays in @preflight/agents because it owns scenario execution.
 * A callback shapes each trace into a scorecard, avoiding an agents-to-metrics
 * dependency while preserving every raw run for later inspection.
 */
export function runMonteCarlo<TScorecard>(
  options: MonteCarloOptions<TScorecard>,
): MonteCarloBatch<TScorecard> {
  if (!Number.isInteger(options.runs) || options.runs <= 0) {
    throw new Error('Monte Carlo runs must be a positive integer')
  }

  const startedAt = performance.now()
  const runs: MonteCarloRun<TScorecard>[] = []
  for (let index = 0; index < options.runs; index++) {
    const seed = `${options.baseSeed}:${index}`
    const trace = runScenario({
      seed,
      config: options.config,
      initialPool: options.initialPool,
      participants: options.participants,
      ...(options.start === undefined ? {} : { start: options.start }),
      ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
    })
    runs.push({ index, seed, trace, scorecard: options.scorecard(trace) })
  }

  return { baseSeed: options.baseSeed, durationMs: performance.now() - startedAt, runs }
}
