import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodeConfig, decodePoolState, TradeDirection } from '@preflight/core'
import type { OracleFixture } from '@preflight/core/oracle'
import { describe, expect, it } from 'vitest'

import { bundler, dumper, runScenario, type AgentContext, type AgentState } from '../src/index.js'
import { Random } from '../src/random.js'

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../core/fixtures/oracle/baseline.json'),
    'utf8',
  ),
) as OracleFixture

const config = decodeConfig(fixture.configAccount)
const initialPool = decodePoolState(fixture.initialPoolState)
const SOL = 1_000_000_000n

function context(self: AgentState, elapsedSeconds = 0n): AgentContext {
  return {
    self,
    pool: initialPool,
    clock: { slot: 300_000_000n, unixTimestamp: 1_767_225_600n + elapsedSeconds },
    elapsedSeconds,
    isCurveComplete: false,
    baseFeeFraction: 0.01,
    random: new Random(1),
  }
}

describe('a bundler', () => {
  const wallets = bundler('bundle', {
    wallets: 3,
    totalSize: 12n * SOL,
    transactionsPerWallet: 2,
    earlyWindowSeconds: 5,
  })

  it('splits a coordinated budget across wallets and transactions', () => {
    expect(wallets.map((wallet) => wallet.id)).toEqual(['bundle-0', 'bundle-1', 'bundle-2'])

    const trace = runScenario({
      seed: 'bundle',
      config,
      initialPool,
      participants: wallets.map((agent) => ({ agent, funding: 4n * SOL })),
      maxSteps: 20,
    })
    const buys = trace.steps.filter((step) => step.archetype === 'bundler')

    expect(buys).toHaveLength(6)
    expect(buys.every((step) => step.direction === TradeDirection.QuoteToBase)).toBe(true)
    expect(buys.reduce((total, step) => total + step.amountIn, 0n)).toBe(12n * SOL)
  })

  it('is deterministic for a seed', () => {
    const run = () =>
      runScenario({
        seed: 'bundle',
        config,
        initialPool,
        participants: wallets.map((agent) => ({ agent, funding: 4n * SOL })),
        maxSteps: 20,
      })
    expect(JSON.stringify(run(), bigintReplacer)).toBe(JSON.stringify(run(), bigintReplacer))
  })
})

describe('a dumper', () => {
  const opening: AgentState = {
    id: 'dumper-1',
    archetype: 'dumper',
    quoteBalance: 10n * SOL,
    baseBalance: 0n,
    costBasisQuote: 0n,
    realisedPnlQuote: 0n,
    trades: 0,
  }

  it('buys first and sells the configured fraction at an elapsed-time trigger', () => {
    const agent = dumper('dumper-1', {
      entrySize: 4n * SOL,
      dumpFraction: 0.75,
      trigger: { kind: 'elapsed-seconds', seconds: 30 },
    })
    expect(agent.decide(context(opening))?.direction).toBe(TradeDirection.QuoteToBase)

    const holding = {
      ...opening,
      quoteBalance: 6n * SOL,
      baseBalance: 800n,
      costBasisQuote: 4n * SOL,
      trades: 1,
    }
    expect(agent.decide(context(holding, 29n))).toBeNull()
    const exit = agent.decide(context(holding, 30n))
    expect(exit).toMatchObject({ direction: TradeDirection.BaseToQuote, amountIn: 600n })
  })

  it('can instead trigger from a configured price multiple', () => {
    const agent = dumper('dumper-1', {
      entrySize: 4n * SOL,
      dumpFraction: 0.5,
      trigger: { kind: 'price-multiple', multiple: 1.5 },
    })
    const holding = { ...opening, baseBalance: 100n, costBasisQuote: 50n, trades: 1 }
    const richPool = { ...initialPool, sqrtPrice: 1n << 64n }
    expect(agent.decide({ ...context(holding), pool: richPool })?.direction).toBe(
      TradeDirection.BaseToQuote,
    )
  })
})

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}
