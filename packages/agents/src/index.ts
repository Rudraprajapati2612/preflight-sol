/**
 * @preflight/agents — who shows up to a launch, and what the curve does about it.
 *
 * The engine answers "what does this trade do". This package answers the
 * question a launcher actually has: what happens when a sniper is first, a
 * whale arrives halfway, and organic buyers trickle in behind them.
 */

export { runScenario } from './scheduler.js'
export type { ScenarioOptions, ScenarioParticipant } from './scheduler.js'
export { organic, sniper, whale } from './archetypes.js'
export { applyTrade, openingPosition } from './position.js'
export { deriveSeed, Random } from './random.js'
export { RecordedClock, SimulatedClock } from './clock.js'
export type { Clock, ClockReading } from './clock.js'
export type { Agent, AgentContext, AgentState, Trace, TraceStep, TradeIntent } from './types.js'
