import { type EngineConfig, type PoolState, VirtualPool } from '@preflight/core'

import { type Clock, type ClockReading, SimulatedClock } from './clock.js'
import { applyTrade, openingPosition } from './position.js'
import { deriveSeed, Random } from './random.js'
import type { Agent, AgentState, Trace, TraceStep } from './types.js'

/**
 * Runs a launch.
 *
 * The scheduler owns the clock and the pool; agents own only their opinions.
 * That split is deliberate: whether this launch's fee scheduler counts slots or
 * seconds is a property of its configuration, and letting an agent see it would
 * leak a detail that has nothing to do with how a trader behaves.
 *
 * Ordering is fixed rather than incidental. Agents that want to act at the same
 * moment are ordered by their delay and then by their position in the roster,
 * never by iteration order, so that a run is reproducible for a reason and not
 * by luck.
 */

export interface ScenarioParticipant {
  readonly agent: Agent
  /** Quote the agent arrives with, in atomic units. */
  readonly funding: bigint
}

export interface ScenarioOptions {
  readonly seed: string
  readonly config: EngineConfig
  readonly initialPool: PoolState
  readonly participants: readonly ScenarioParticipant[]
  /** Where the clock starts. Defaults to a plausible launch moment. */
  readonly start?: ClockReading
  /** Stops a runaway scenario rather than looping forever. */
  readonly maxSteps?: number
  /** Supplied by historical replay; simulations use the derived clock. */
  readonly clock?: Clock
}

const DEFAULT_START: ClockReading = { slot: 300_000_000n, unixTimestamp: 1_767_225_600n }
const DEFAULT_MAX_STEPS = 500

export function runScenario(options: ScenarioOptions): Trace {
  const clock = options.clock ?? new SimulatedClock(options.start ?? DEFAULT_START)
  const openedAt = clock.now().unixTimestamp
  const pool = new VirtualPool(options.config, options.initialPool)
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS

  const streams = new Map<string, Random>()
  const positions = new Map<string, AgentState>()
  for (const { agent, funding } of options.participants) {
    streams.set(agent.id, new Random(deriveSeed(options.seed, agent.id)))
    positions.set(agent.id, openingPosition(agent.id, agent.archetype, funding))
  }

  const steps: TraceStep[] = []
  let reason: Trace['reason'] = 'step-limit'

  while (steps.length < maxSteps) {
    if (pool.isCurveComplete) {
      reason = 'curve-complete'
      break
    }

    // Collect intentions before executing any of them, so that no agent is
    // reacting to a trade made in the same round.
    // Read once per round rather than per agent: every agent deciding in the
    // same round is looking at the same moment.
    const roundStart = clock.now()
    const baseFeeFraction = pool.baseFeeFraction(
      VirtualPool.currentPoint(options.config, roundStart),
    )

    const proposals = options.participants
      .map(({ agent }, index) => {
        const random = streams.get(agent.id)!
        const randomPosition = random.position
        const intent = agent.decide({
          self: positions.get(agent.id)!,
          pool: pool.state,
          clock: clock.now(),
          elapsedSeconds: clock.now().unixTimestamp - openedAt,
          isCurveComplete: pool.isCurveComplete,
          baseFeeFraction,
          random,
        })
        return { agent, index, intent, randomPosition }
      })
      .filter((proposal) => proposal.intent !== null)

    if (proposals.length === 0) {
      reason = 'no-more-trades'
      break
    }

    // Sooner first; ties broken by roster position, never by iteration order.
    proposals.sort((a, b) => {
      const byDelay = Number(a.intent!.delaySeconds - b.intent!.delaySeconds)
      return byDelay !== 0 ? byDelay : a.index - b.index
    })

    let advanced = 0n
    for (const proposal of proposals) {
      const intent = proposal.intent!
      if (pool.isCurveComplete) break

      const gap = intent.delaySeconds - advanced
      if (gap > 0n) {
        clock.advance(gap)
        advanced = intent.delaySeconds
      }

      const reading = clock.now()
      let outcome
      try {
        outcome = pool.swap(intent.amountIn, intent.direction, {
          currentPoint: VirtualPool.currentPoint(options.config, reading),
          currentTimestamp: reading.unixTimestamp,
          ...(intent.partialFill === undefined ? {} : { partialFill: intent.partialFill }),
        })
      } catch {
        // A trade the curve cannot serve is a trade that does not happen. A
        // real trader's transaction would simply fail.
        continue
      }

      const updated = applyTrade(
        positions.get(proposal.agent.id)!,
        intent.direction,
        outcome.result,
      )
      positions.set(proposal.agent.id, updated)

      steps.push({
        step: steps.length,
        agentId: proposal.agent.id,
        archetype: proposal.agent.archetype,
        clock: reading,
        direction: intent.direction,
        amountIn: intent.amountIn,
        partialFill: intent.partialFill ?? false,
        result: outcome.result,
        poolAfter: outcome.stateAfter,
        agentAfter: updated,
        randomPosition: proposal.randomPosition,
      })

      if (steps.length >= maxSteps) break
    }

    // Always move time forward, so a round in which everyone sat out cannot
    // spin without the clock changing.
    if (advanced === 0n) clock.advance(1n)
  }

  if (pool.isCurveComplete) reason = 'curve-complete'

  return {
    seed: options.seed,
    steps,
    finalPool: pool.state,
    agents: options.participants.map(({ agent }) => positions.get(agent.id)!),
    curveCompleted: pool.isCurveComplete,
    reason,
  }
}
