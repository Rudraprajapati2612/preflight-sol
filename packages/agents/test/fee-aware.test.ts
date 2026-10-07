import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodeConfig, decodePoolState, TradeDirection } from '@preflight/core'
import { type OracleFixture } from '@preflight/core/oracle'
import { describe, expect, it } from 'vitest'

import { organic, runScenario, sniper } from '../src/index.js'
import type { AgentContext, AgentState } from '../src/types.js'
import { Random } from '../src/random.js'

/**
 * A fee schedule is only a defence if it changes somebody's behaviour.
 *
 * The program lets a launch open at 99% and decay to 0.25%, and the whole
 * purpose of that is to make being first expensive. A sniper that buys at t=0
 * whatever the fee is makes the schedule decorative: it would pay the fee,
 * still hit its exit multiple, and the simulator would report that raising the
 * fee forty-fold moved sniper capture by two points — which is what it did
 * report before this.
 */

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../core/fixtures/oracle/baseline.json'),
    'utf8',
  ),
) as OracleFixture

const config = decodeConfig(fixture.configAccount)
const initialPool = decodePoolState(fixture.initialPoolState)
const SOL = 1_000_000_000n

/** The baseline recording is a flat 1% fee, which is what the thresholds straddle. */
const BASELINE_FEE = 0.01

function contextWith(baseFeeFraction: number): AgentContext {
  const self: AgentState = {
    id: 'sniper-1',
    archetype: 'sniper',
    quoteBalance: 100n * SOL,
    baseBalance: 0n,
    costBasisQuote: 0n,
    realisedPnlQuote: 0n,
    trades: 0,
  }
  return {
    self,
    pool: initialPool,
    clock: { slot: 300_000_000n, unixTimestamp: 1_767_225_600n },
    elapsedSeconds: 0n,
    isCurveComplete: false,
    baseFeeFraction,
    random: new Random(1),
  }
}

describe('a fee-aware sniper', () => {
  it('bids when getting in costs less than it will accept', () => {
    const agent = sniper('sniper-1', { size: 8n * SOL, exitMultiple: 1.5, maxEntryFee: 0.03 })
    const intent = agent.decide(contextWith(0.01))

    expect(intent).not.toBeNull()
    expect(intent!.direction).toBe(TradeDirection.QuoteToBase)
    expect(intent!.delaySeconds).toBe(0n)
  })

  it('waits when getting in costs more', () => {
    const agent = sniper('sniper-1', { size: 8n * SOL, exitMultiple: 1.5, maxEntryFee: 0.03 })
    expect(agent.decide(contextWith(0.08))).toBeNull()
  })

  it('treats the threshold as inclusive, so an exactly affordable fee still bids', () => {
    const agent = sniper('sniper-1', { size: 8n * SOL, exitMultiple: 1.5, maxEntryFee: 0.03 })
    expect(agent.decide(contextWith(0.03))).not.toBeNull()
  })

  it('ignores the fee entirely when no threshold is set', () => {
    const agent = sniper('sniper-1', { size: 8n * SOL, exitMultiple: 1.5 })
    expect(agent.decide(contextWith(0.98))).not.toBeNull()
  })
})

describe('the fee a launch charges', () => {
  const crowd = (maxEntryFee: number | undefined) => [
    {
      agent: sniper('sniper-1', {
        size: 8n * SOL,
        exitMultiple: 1.5,
        ...(maxEntryFee === undefined ? {} : { maxEntryFee }),
      }),
      funding: 40n * SOL,
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

  const run = (maxEntryFee: number | undefined) =>
    runScenario({
      seed: 'fee-aware',
      config,
      initialPool,
      maxSteps: 400,
      participants: crowd(maxEntryFee),
    })

  it('is the fee the program would charge, not one the scheduler invented', () => {
    // A probe rather than an assertion about behaviour: it never trades, it
    // only writes down what it was shown. The baseline recording is a flat 1%,
    // so every round of the launch must report exactly that.
    const seen: number[] = []
    const probe = {
      id: 'probe',
      archetype: 'probe',
      decide: (context: AgentContext) => {
        seen.push(context.baseFeeFraction)
        return null
      },
    }

    runScenario({
      seed: 'fee-aware',
      config,
      initialPool,
      maxSteps: 400,
      participants: [{ agent: probe, funding: 0n }, ...crowd(undefined)],
    })

    expect(seen.length).toBeGreaterThan(1)
    for (const fee of seen) expect(fee).toBeCloseTo(BASELINE_FEE, 12)
  })

  it('keeps a sniper out when it exceeds what the sniper will pay', () => {
    const trace = run(BASELINE_FEE / 2)
    expect(trace.steps.some((step) => step.archetype === 'sniper')).toBe(false)
  })

  it('does not keep it out when it does not', () => {
    const trace = run(BASELINE_FEE * 2)
    const first = trace.steps[0]
    expect(first?.archetype).toBe('sniper')
  })

  it('leaves the launch to run without the sniper rather than stalling it', () => {
    const withoutSniper = run(BASELINE_FEE / 2)
    expect(withoutSniper.steps.length).toBeGreaterThan(0)
    expect(withoutSniper.reason).not.toBe('step-limit')
  })
})
