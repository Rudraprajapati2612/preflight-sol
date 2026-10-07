import type { PoolState, SwapResult, TradeDirection } from '@preflight/core'

import type { ClockReading } from './clock.js'
import type { Random } from './random.js'

/** What an agent wants to do, expressed without reference to any clock. */
export interface TradeIntent {
  readonly direction: TradeDirection
  readonly amountIn: bigint
  /** Allow the curve to consume only part of the input rather than reverting. */
  readonly partialFill?: boolean
  /** How long the agent waits before acting, in seconds. */
  readonly delaySeconds: bigint
}

/** An agent's holdings and history. */
export interface AgentState {
  readonly id: string
  readonly archetype: string
  readonly quoteBalance: bigint
  readonly baseBalance: bigint
  /** Quote spent acquiring the base currently held. */
  readonly costBasisQuote: bigint
  /** Profit taken on base already sold, in quote. */
  readonly realisedPnlQuote: bigint
  readonly trades: number
}

/** What an agent can see when it decides. */
export interface AgentContext {
  readonly self: AgentState
  readonly pool: PoolState
  readonly clock: ClockReading
  /** Seconds since the launch opened. */
  readonly elapsedSeconds: bigint
  readonly isCurveComplete: boolean
  /**
   * The scheduled base fee a trade would pay right now, as a fraction.
   *
   * Published in the config account, so a trader can read it before deciding
   * whether to trade. An agent that could not see it would be blinder than a
   * real one rather than more conservative — and a fee schedule whose whole
   * purpose is to change behaviour would change nothing.
   */
  readonly baseFeeFraction: number
  /** The agent's own random stream. Never shared. */
  readonly random: Random
}

/**
 * An agent decides what to do and nothing else.
 *
 * It does not execute, does not know the clock model, and cannot see other
 * agents' holdings — only what the pool makes public, which is what a real
 * trader sees too.
 */
export interface Agent {
  readonly id: string
  readonly archetype: string
  decide(context: AgentContext): TradeIntent | null
}

/** One executed trade, with everything needed to reproduce or audit it. */
export interface TraceStep {
  readonly step: number
  readonly agentId: string
  readonly archetype: string
  readonly clock: ClockReading
  readonly direction: TradeDirection
  readonly amountIn: bigint
  readonly partialFill: boolean
  readonly result: SwapResult
  readonly poolAfter: PoolState
  readonly agentAfter: AgentState
  /**
   * Where the agent's random stream stood before it decided. A run that claims
   * to be reproducible should be able to prove it, not just assert it.
   */
  readonly randomPosition: number
}

export interface Trace {
  readonly seed: string
  readonly steps: readonly TraceStep[]
  readonly finalPool: PoolState
  readonly agents: readonly AgentState[]
  readonly curveCompleted: boolean
  readonly reason: 'curve-complete' | 'no-more-trades' | 'step-limit'
}
