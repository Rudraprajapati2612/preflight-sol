import { organic, runScenario, sniper, whale } from '@preflight/agents'
import type { Trace } from '@preflight/agents'
import {
  baselineConfig,
  CollectFeeMode,
  deriveLaunchMetrics,
  type QuoteAsset,
  engineConfigFromParams,
  SOL,
  TokenProgram,
  USDC,
  validateLaunchConfig,
} from '@preflight/config'
import {
  type EngineConfig,
  openingBaseReserve,
  type PoolState,
  TradeDirection,
} from '@preflight/core'
import {
  buildReport,
  curveShape,
  type CurveShapePoint,
  type LaunchReport,
  priceFromSqrtPrice,
} from '@preflight/metrics'

import { scenarioFor, type ScenarioKey } from './scenarios'

/**
 * Runs a launch in the browser.
 *
 * The whole engine is plain arithmetic, so the simulation happens on the
 * viewer's machine with no server involved. Changing a fee and seeing the
 * holder distribution move should feel immediate, and a round trip would make
 * exploring a curve feel like filing a request.
 */

/**
 * A tokenized equity, described the way a real one behaves: Token-2022 with the
 * extensions a regulated asset tends to carry, which is what makes it need a
 * TokenBadge from Meteora.
 */
export const TOKENIZED_EQUITY: QuoteAsset = {
  mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcAgoNZSyNfvHDf',
  symbol: 'AAPLx',
  decimals: 6,
  program: TokenProgram.Token2022,
  extensions: ['TransferHook', 'PermanentDelegate', 'MetadataPointer'],
}

export const QUOTE_ASSETS = { SOL, USDC, AAPLx: TOKENIZED_EQUITY } as const
export type QuoteKey = keyof typeof QUOTE_ASSETS

/** A sensible raise to open with, in whole quote tokens, per quote asset. */
export const DEFAULT_THRESHOLD: Record<QuoteKey, number> = {
  SOL: 50,
  USDC: 10_000,
  AAPLx: 750,
}

export interface FeeDecay {
  readonly mode: 'linear' | 'exponential'
  /** Where the fee settles once the schedule has run, in basis points. */
  readonly endingFeeBps: number
  /** How long the decay takes, in seconds. */
  readonly durationSeconds: number
  readonly periods: number
}

export interface LaunchInputs {
  readonly quote: QuoteKey
  readonly totalTokenSupply: number
  readonly migrationQuoteThreshold: number
  readonly percentageSupplyOnMigration: number
  readonly startingFeeBps: number
  /** Null means a flat fee that never moves. */
  readonly feeDecay: FeeDecay | null
  readonly dynamicFee: boolean
  readonly collectFeeIn: 'quote' | 'output'
  readonly creatorFeeShare: number
  readonly scenario: ScenarioKey
  /** Hand-edited crowd. Null means the scenario's own mix. */
  readonly crowd: Crowd | null
  readonly seed: string
}

export interface Crowd {
  readonly snipers: number
  readonly whales: number
  readonly organics: number
}

export const DEFAULT_INPUTS: LaunchInputs = {
  quote: 'SOL',
  totalTokenSupply: 1_000_000_000,
  migrationQuoteThreshold: 50,
  percentageSupplyOnMigration: 20,
  startingFeeBps: 100,
  feeDecay: null,
  dynamicFee: false,
  collectFeeIn: 'quote',
  creatorFeeShare: 0,
  scenario: 'adversarial',
  crowd: null,
  seed: 'preflight',
}

/** The crowd a set of inputs actually runs with. */
export function crowdOf(inputs: LaunchInputs): Crowd {
  if (inputs.crowd) return inputs.crowd
  const scenario = scenarioFor(inputs.scenario)
  return { snipers: scenario.snipers, whales: scenario.whales, organics: scenario.organics }
}

/**
 * What happened, in facts rather than in numbers.
 *
 * Every field here is read off the trace the engine produced. Nothing is
 * estimated, and nothing is phrased: the page turns these into sentences, so
 * that a claim on screen can always be traced back to a step that occurred.
 */
export interface LaunchFacts {
  /** Why the run stopped, straight from the scheduler. */
  readonly endReason: Trace['reason']
  readonly firstBuy: {
    readonly archetype: string
    /** Base bought, as a share of total supply. */
    readonly supplyShare: number
  } | null
  /** Present only when a sniper traded at all. */
  readonly snipers: {
    readonly count: number
    /** Peak combined holding during the run, as a share of total supply. */
    readonly peakSupplyShare: number
    /** Seconds from the first trade to the last sniper sell, if any sold. */
    readonly exitedAtSeconds: number | null
    /** Quote taken out, net of what was paid in. Negative means they lost. */
    readonly realisedPnlQuote: bigint
    /** Share of total supply the snipers were still holding at the end. */
    readonly endingSupplyShare: number
  } | null
  /** Largest single buy in the run, as a share of total supply. */
  readonly largestBuySupplyShare: number
  /** Quote that sellers took back out of the curve. */
  readonly quoteSoldBack: bigint
  /**
   * Fees, kept apart by the token they were taken in.
   *
   * Under OutputToken collection a buy is charged in the token being bought
   * and a sell in the quote, so the two buckets are different assets with
   * different precisions. Adding them would produce a number in no unit at
   * all — which, at six decimals against nine, is wrong by a thousand while
   * still looking like an amount of SOL.
   */
  readonly fees: {
    readonly quote: bigint
    readonly base: bigint
    readonly partner: { readonly quote: bigint; readonly base: bigint }
    readonly protocol: { readonly quote: bigint; readonly base: bigint }
    readonly creator: { readonly quote: bigint; readonly base: bigint }
  }
  /** How far the closing price sits below the peak, as a fraction. */
  readonly drawdownFromPeak: number
  /** Share of the raise that was reached in the first minute. */
  readonly raisedInFirstMinute: number
}

/** One executed trade, flattened for display. */
export interface TapeRow {
  readonly step: number
  /** Seconds since the first trade. */
  readonly at: number
  readonly actor: string
  readonly archetype: string
  readonly side: 'buy' | 'sell'
  /** What went in, including the fee, in atomic units of the input token. */
  readonly amountIn: bigint
  /** What came back, in atomic units of the output token. */
  readonly amountOut: bigint
  /** Price of one whole base token after the trade, in whole quote tokens. */
  readonly price: number
  /** Quote held by the curve after the trade. */
  readonly raised: bigint
  readonly partialFill: boolean
}

/** What one kind of participant walked away with. */
export interface GroupOutcome {
  readonly archetype: string
  readonly holders: number
  /** Share of the supply still held, of everything held at the end. */
  readonly share: number
  readonly baseHeld: bigint
  /** Quote taken out beyond what was paid in. Negative means they lost. */
  readonly realisedPnlQuote: bigint
}

export interface SimulationOutput {
  readonly report: LaunchReport
  /** Final holdings per participant, for the concentration breakdown. */
  readonly agents: Trace['agents']
  /** The curve as designed, before fees or traders. */
  readonly shape: readonly CurveShapePoint[]
  readonly findings: ReturnType<typeof validateLaunchConfig>['findings']
  readonly valid: boolean
  readonly derived: ReturnType<typeof deriveLaunchMetrics>
  readonly quoteAsset: QuoteAsset
  readonly facts: LaunchFacts
  readonly crowd: Crowd
  /** Every trade, in the order it executed. */
  readonly tape: readonly TapeRow[]
  readonly groups: readonly GroupOutcome[]
  /** The exact argument that would build this curve, for export. */
  readonly configArgs: Record<string, unknown>
}

/** The pool a config starts from, before anyone has traded. */
function openingPool(config: EngineConfig): PoolState {
  return {
    sqrtPrice: config.sqrtStartPrice,
    // What the program would put in the vault: the base the curve has to sell
    // plus what is held back for the graduated pool. Derived rather than
    // invented, so the reserve shown to a reader is the real figure.
    baseReserve: openingBaseReserve(config),
    quoteReserve: 0n,
    protocolBaseFee: 0n,
    protocolQuoteFee: 0n,
    partnerBaseFee: 0n,
    partnerQuoteFee: 0n,
    creatorBaseFee: 0n,
    creatorQuoteFee: 0n,
    activationPoint: 1_767_225_600n,
    volatilityTracker: {
      lastUpdateTimestamp: 0n,
      sqrtPriceReference: config.sqrtStartPrice,
      volatilityAccumulator: 0n,
      volatilityReference: 0n,
    },
    hasSwap: false,
  }
}

export function simulate(inputs: LaunchInputs): SimulationOutput {
  const quoteAsset = QUOTE_ASSETS[inputs.quote]
  const scenario = scenarioFor(inputs.scenario)
  const crowd = crowdOf(inputs)

  const decays = inputs.feeDecay !== null && inputs.feeDecay.endingFeeBps < inputs.startingFeeBps

  const options = {
    quoteDecimals: quoteAsset.decimals,
    migrationQuoteThreshold: inputs.migrationQuoteThreshold,
    totalTokenSupply: inputs.totalTokenSupply,
    percentageSupplyOnMigration: inputs.percentageSupplyOnMigration,
    startingFeeBps: inputs.startingFeeBps,
    dynamicFee: inputs.dynamicFee,
    creatorTradingFeePercentage: inputs.creatorFeeShare,
    collectFeeMode:
      inputs.collectFeeIn === 'output' ? CollectFeeMode.OutputToken : CollectFeeMode.QuoteToken,
    // A schedule only exists when the fee is meant to move. A schedule that
    // ends where it starts is a flat fee, and the program rejects a period
    // count attached to one — "numberOfPeriod and totalDuration must both be
    // zero" — so it is treated as flat rather than as a configuration error.
    ...(decays && inputs.feeDecay
      ? {
          endingFeeBps: inputs.feeDecay.endingFeeBps,
          feeSchedule: {
            mode: inputs.feeDecay.mode,
            numberOfPeriod: inputs.feeDecay.periods,
            totalDuration: inputs.feeDecay.durationSeconds,
          },
        }
      : {}),
  }

  const params = baselineConfig(options)

  const validation = validateLaunchConfig(params, quoteAsset)
  const derived = deriveLaunchMetrics(params, quoteAsset)

  const config = engineConfigFromParams(params)
  const unit = 10n ** BigInt(quoteAsset.decimals)
  const budget = BigInt(Math.max(1, inputs.migrationQuoteThreshold)) * unit

  const trace = runScenario({
    seed: inputs.seed,
    config,
    initialPool: openingPool(config),
    maxSteps: 600,
    participants: [
      ...Array.from({ length: crowd.snipers }, (_, i) => ({
        agent: sniper(`sniper-${i}`, {
          size: budget / 6n,
          exitMultiple: 1.6,
          // A bot targeting +60% will not hand a fifth of that back at the
          // door. Above this it waits for the schedule to bring the fee down,
          // and under a flat fee it waits for good.
          maxEntryFee: 0.03,
        }),
        funding: budget,
      })),
      ...Array.from({ length: crowd.whales }, (_, i) => ({
        agent: whale(`whale-${i}`, {
          size: budget / 4n,
          minGapSeconds: 20,
          maxGapSeconds: 90,
          patience: 0.35,
        }),
        funding: budget * 3n,
      })),
      ...Array.from({ length: crowd.organics }, (_, i) => ({
        agent: organic(`organic-${i}`, {
          minSize: budget / 250n,
          maxSize: budget / 20n,
          sellChance: scenario.sellChance,
          activity: scenario.activity,
        }),
        funding: budget / 2n,
      })),
    ],
  })

  return {
    report: buildReport({ trace, config, baseDecimals: 6, quoteAsset }),
    agents: trace.agents,
    shape: curveShape(config, 6, quoteAsset.decimals),
    findings: validation.findings,
    valid: validation.valid,
    derived,
    quoteAsset,
    facts: factsFrom(trace, BigInt(inputs.totalTokenSupply) * 1_000_000n),
    crowd,
    tape: tapeFrom(trace, quoteAsset.decimals),
    groups: groupsFrom(trace),
    configArgs: options,
  }
}

/** Every executed trade, flattened for the tape. */
function tapeFrom(trace: Trace, quoteDecimals: number): TapeRow[] {
  const openedAt = trace.steps[0]?.clock.unixTimestamp ?? 0n

  return trace.steps.map((step) => ({
    step: step.step,
    at: Number(step.clock.unixTimestamp - openedAt),
    actor: step.agentId,
    archetype: step.archetype,
    side: step.direction === TradeDirection.QuoteToBase ? ('buy' as const) : ('sell' as const),
    amountIn: step.result.includedFeeInputAmount,
    amountOut: step.result.outputAmount,
    price: priceFromSqrtPrice(step.poolAfter.sqrtPrice, 6, quoteDecimals),
    raised: step.poolAfter.quoteReserve,
    partialFill: step.partialFill,
  }))
}

/**
 * What each kind of participant walked away with.
 *
 * The realised figure answers the question the share alone cannot: a sniper
 * holding nothing at the end looks harmless until you see what it took out on
 * the way. Shares are of the supply still held, which is the same denominator
 * the concentration measure uses.
 */
function groupsFrom(trace: Trace): GroupOutcome[] {
  const totalHeld = trace.agents.reduce((total, agent) => total + agent.baseBalance, 0n)
  const byArchetype = new Map<string, GroupOutcome>()

  for (const agent of trace.agents) {
    const existing = byArchetype.get(agent.archetype)
    const baseHeld = (existing?.baseHeld ?? 0n) + agent.baseBalance
    byArchetype.set(agent.archetype, {
      archetype: agent.archetype,
      holders: (existing?.holders ?? 0) + (agent.baseBalance > 0n ? 1 : 0),
      baseHeld,
      share: totalHeld > 0n ? Number((baseHeld * 1_000_000n) / totalHeld) / 1_000_000 : 0,
      realisedPnlQuote: (existing?.realisedPnlQuote ?? 0n) + agent.realisedPnlQuote,
    })
  }

  return [...byArchetype.values()].sort((a, b) => b.share - a.share)
}

/**
 * Read the story off the trace.
 *
 * The interesting events of a launch are not in the summary statistics — a
 * sniper that bought a third of the float and left with a profit shows up as
 * "snipers kept 0%", which reads as though nothing happened. These are the
 * facts that make an outcome explicable.
 */
function factsFrom(trace: Trace, totalSupplyAtomic: bigint): LaunchFacts {
  const steps = trace.steps
  const share = (atomic: bigint): number =>
    totalSupplyAtomic > 0n ? Number((atomic * 1_000_000n) / totalSupplyAtomic) / 1_000_000 : 0

  const first = steps[0]
  const openedAt = first?.clock.unixTimestamp ?? 0n

  const buys = steps.filter((step) => step.direction === TradeDirection.QuoteToBase)
  const sells = steps.filter((step) => step.direction === TradeDirection.BaseToQuote)

  const largestBuy = buys.reduce((best, step) => {
    const amount = step.result.outputAmount
    return amount > best ? amount : best
  }, 0n)

  // The snipers' combined holding is tracked through the run rather than read
  // at the end, because the whole point of a sniper is that the position is
  // gone by then.
  const sniperIds = new Set(
    trace.agents.filter((agent) => agent.archetype === 'sniper').map((agent) => agent.id),
  )
  const holdings = new Map<string, bigint>()
  let peakSniperHolding = 0n
  let lastSniperExit: bigint | null = null
  for (const step of steps) {
    if (!sniperIds.has(step.agentId)) continue
    holdings.set(step.agentId, step.agentAfter.baseBalance)
    const combined = [...holdings.values()].reduce((total, value) => total + value, 0n)
    if (combined > peakSniperHolding) peakSniperHolding = combined
    if (step.direction === TradeDirection.BaseToQuote) lastSniperExit = step.clock.unixTimestamp
  }

  const sniperAgents = trace.agents.filter((agent) => agent.archetype === 'sniper')
  const sniperTraded = steps.some((step) => sniperIds.has(step.agentId))

  const quoteSoldBack = sells.reduce((total, step) => total + step.result.outputAmount, 0n)

  const finalRaise = trace.finalPool.quoteReserve
  const minuteMark = openedAt + 60n
  const raisedByMinute =
    steps.filter((step) => step.clock.unixTimestamp <= minuteMark).at(-1)?.poolAfter.quoteReserve ??
    0n

  const peak = Math.max(0, ...steps.map((step) => Number(step.poolAfter.sqrtPrice)))
  const closing = Number(trace.finalPool.sqrtPrice)
  // Square-root prices compare the same way prices do, and staying in sqrt
  // space avoids a decimals argument this function has no business knowing.
  const drawdown = peak > 0 ? Math.max(0, 1 - (closing * closing) / (peak * peak)) : 0

  const pool = trace.finalPool

  return {
    endReason: trace.reason,
    firstBuy: first
      ? {
          archetype: first.archetype,
          supplyShare: share(first.result.outputAmount),
        }
      : null,
    snipers: sniperTraded
      ? {
          count: sniperAgents.length,
          peakSupplyShare: share(peakSniperHolding),
          exitedAtSeconds: lastSniperExit === null ? null : Number(lastSniperExit - openedAt),
          realisedPnlQuote: sniperAgents.reduce(
            (total, agent) => total + agent.realisedPnlQuote,
            0n,
          ),
          endingSupplyShare: share(
            sniperAgents.reduce((total, agent) => total + agent.baseBalance, 0n),
          ),
        }
      : null,
    largestBuySupplyShare: share(largestBuy),
    quoteSoldBack,
    fees: {
      quote: pool.protocolQuoteFee + pool.partnerQuoteFee + pool.creatorQuoteFee,
      base: pool.protocolBaseFee + pool.partnerBaseFee + pool.creatorBaseFee,
      partner: { quote: pool.partnerQuoteFee, base: pool.partnerBaseFee },
      protocol: { quote: pool.protocolQuoteFee, base: pool.protocolBaseFee },
      creator: { quote: pool.creatorQuoteFee, base: pool.creatorBaseFee },
    },
    drawdownFromPeak: drawdown,
    raisedInFirstMinute:
      finalRaise > 0n ? Number((raisedByMinute * 10_000n) / finalRaise) / 10_000 : 0,
  }
}
