import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodeConfig, decodePoolState, TradeDirection } from '@preflight/core'
import { type OracleFixture } from '@preflight/core/oracle'
import { describe, expect, it } from 'vitest'

import { organic, runScenario, sniper, type ScenarioParticipant, whale } from '../src/index.js'

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../core/fixtures/oracle/baseline.json'),
    'utf8',
  ),
) as OracleFixture

const config = decodeConfig(fixture.configAccount)
const initialPool = decodePoolState(fixture.initialPoolState)
const SOL = 1_000_000_000n

function launch(): ScenarioParticipant[] {
  return [
    { agent: sniper('sniper-1', { size: 8n * SOL, exitMultiple: 1.5 }), funding: 40n * SOL },
    {
      agent: whale('whale-1', {
        size: 15n * SOL,
        minGapSeconds: 20,
        maxGapSeconds: 90,
        patience: 0.35,
      }),
      funding: 120n * SOL,
    },
    ...Array.from({ length: 6 }, (_, index) => ({
      agent: organic(`organic-${index}`, {
        minSize: SOL / 5n,
        maxSize: 3n * SOL,
        sellChance: 0.25,
        activity: 0.4,
      }),
      funding: 25n * SOL,
    })),
  ]
}

const run = (seed: string) =>
  runScenario({ seed, config, initialPool, participants: launch(), maxSteps: 400 })

describe('a simulated launch', () => {
  it('trades, moves the price, and reaches migration', () => {
    const trace = run('demo')

    expect(trace.steps.length).toBeGreaterThan(5)
    expect(trace.curveCompleted).toBe(true)
    expect(trace.reason).toBe('curve-complete')
    expect(trace.finalPool.quoteReserve).toBeGreaterThanOrEqual(config.migrationQuoteThreshold)
    expect(trace.finalPool.sqrtPrice).toBeGreaterThan(initialPool.sqrtPrice)
  })

  it('is byte-identical on the same seed', () => {
    // The whole point of a simulator is comparing configurations. If two runs
    // of the same scenario differ, any difference between two configs might be
    // the config or might be the dice, and the tool is useless.
    const a = JSON.stringify(run('demo'), replacer)
    const b = JSON.stringify(run('demo'), replacer)
    expect(a).toBe(b)
  })

  it('gives different launches on different seeds', () => {
    const a = JSON.stringify(run('demo'), replacer)
    const b = JSON.stringify(run('other'), replacer)
    expect(a).not.toBe(b)
  })

  it('gives each agent its own random stream', () => {
    // Adding a participant must not reshuffle everyone else's behaviour, or two
    // scenarios differing by one trader would be incomparable.
    const base = runScenario({
      seed: 'streams',
      config,
      initialPool,
      participants: launch().slice(0, 2),
      maxSteps: 60,
    })
    const extended = runScenario({
      seed: 'streams',
      config,
      initialPool,
      participants: [...launch().slice(0, 2), ...launch().slice(2, 3)],
      maxSteps: 60,
    })

    const firstTrade = (trace: typeof base, id: string) =>
      trace.steps.find((step) => step.agentId === id)
    expect(firstTrade(extended, 'sniper-1')?.amountIn).toBe(firstTrade(base, 'sniper-1')?.amountIn)
  })

  it('the sniper is first, and buys before anyone else', () => {
    const trace = run('demo')
    expect(trace.steps[0]!.archetype).toBe('sniper')
    expect(trace.steps[0]!.direction).toBe(TradeDirection.QuoteToBase)
  })

  it('never spends quote an agent does not have', () => {
    const trace = run('demo')
    for (const agent of trace.agents) {
      expect(agent.quoteBalance).toBeGreaterThanOrEqual(0n)
      expect(agent.baseBalance).toBeGreaterThanOrEqual(0n)
    }
  })

  it('conserves quote: nothing is created and nothing goes missing', () => {
    const participants = launch()
    const trace = runScenario({
      seed: 'demo',
      config,
      initialPool,
      participants,
      maxSteps: 400,
    })
    expectQuoteConserved(trace, participants, initialPool)
  })

  it('conserves base: what agents hold is what the pool released', () => {
    const trace = run('demo')
    const heldByAgents = trace.agents.reduce((total, agent) => total + agent.baseBalance, 0n)
    const releasedByPool = initialPool.baseReserve - trace.finalPool.baseReserve
    // Fees taken in the base token would sit outside agent balances; this
    // config collects in quote, so the two sides must agree exactly.
    expect(heldByAgents).toBe(releasedByPool)
  })
})

/**
 * Quote is neither created nor destroyed: whatever the traders arrived with,
 * plus whatever the pool started with, is still somewhere afterwards — in a
 * trader's balance, in the pool's reserve, or retained as a fee.
 *
 * This is the check that catches paying the wrong amount. Under quote-token
 * fees the trader is debited the fee-inclusive input while only the
 * fee-exclusive part reaches the reserve, and confusing the two leaves the
 * traders collectively richer than they should be by exactly the fees.
 */
function expectQuoteConserved(
  trace: ReturnType<typeof runScenario>,
  participants: readonly ScenarioParticipant[],
  startingPool: typeof initialPool,
): void {
  const funded = participants.reduce((total, p) => total + p.funding, 0n)
  const heldByAgents = trace.agents.reduce((total, agent) => total + agent.quoteBalance, 0n)
  const feesInQuote =
    trace.finalPool.protocolQuoteFee +
    trace.finalPool.partnerQuoteFee +
    trace.finalPool.creatorQuoteFee

  expect(heldByAgents + trace.finalPool.quoteReserve + feesInQuote).toBe(
    funded + startingPool.quoteReserve,
  )
}

/** bigints do not survive JSON on their own. */
function replacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

const outputFeeFixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../core/fixtures/oracle/output-fee.json'),
    'utf8',
  ),
) as OracleFixture

describe('a launch that collects fees in the token being bought', () => {
  const outputConfig = decodeConfig(outputFeeFixture.configAccount)
  const outputInitial = decodePoolState(outputFeeFixture.initialPoolState)

  it('credits traders only what they actually received', () => {
    // Under output-token fees the program nets the fee out of the amount
    // delivered. Adding it back would hand the trader fees they paid, and the
    // error is invisible in a price chart: it only shows up as base that the
    // pool released but nobody holds.
    const trace = runScenario({
      seed: 'output-fee',
      config: outputConfig,
      initialPool: outputInitial,
      participants: launch(),
      maxSteps: 400,
    })

    expect(trace.steps.length).toBeGreaterThan(5)

    const heldByAgents = trace.agents.reduce((total, agent) => total + agent.baseBalance, 0n)
    const releasedByPool = outputInitial.baseReserve - trace.finalPool.baseReserve
    const feesHeldInBase =
      trace.finalPool.protocolBaseFee +
      trace.finalPool.partnerBaseFee +
      trace.finalPool.creatorBaseFee

    // Everything the pool released is either held by a trader or retained as a
    // fee. Nothing is created and nothing goes missing.
    expect(heldByAgents + feesHeldInBase).toBe(releasedByPool)
    expect(feesHeldInBase).toBeGreaterThan(0n)
    expectQuoteConserved(trace, launch(), outputInitial)
  })
})
