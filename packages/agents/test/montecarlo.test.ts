import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodeConfig, decodePoolState } from '@preflight/core'
import type { OracleFixture } from '@preflight/core/oracle'
import { describe, expect, it } from 'vitest'

import { organic, runMonteCarlo } from '../src/index.js'

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../core/fixtures/oracle/baseline.json'),
    'utf8',
  ),
) as OracleFixture

const config = decodeConfig(fixture.configAccount)
const initialPool = decodePoolState(fixture.initialPoolState)
const SOL = 1_000_000_000n

const participants = [
  {
    agent: organic('organic-1', {
      minSize: SOL / 10n,
      maxSize: SOL,
      sellChance: 0.25,
      activity: 0.6,
    }),
    funding: 20n * SOL,
  },
]

const batch = (baseSeed: string, runs = 6) =>
  runMonteCarlo({
    baseSeed,
    runs,
    config,
    initialPool,
    participants,
    maxSteps: 20,
    scorecard: (trace) => ({ graduated: trace.curveCompleted, trades: trace.steps.length }),
  })

describe('runMonteCarlo', () => {
  it('reproduces the same raw batch from one base seed', () => {
    const a = batch('batch')
    const b = batch('batch')

    expect(a.runs.map((run) => run.seed)).toEqual([
      'batch:0',
      'batch:1',
      'batch:2',
      'batch:3',
      'batch:4',
      'batch:5',
    ])
    expect(JSON.stringify(a.runs, bigintReplacer)).toBe(JSON.stringify(b.runs, bigintReplacer))
  })

  it('changes the batch when the base seed changes', () => {
    expect(JSON.stringify(batch('one').runs, bigintReplacer)).not.toBe(
      JSON.stringify(batch('two').runs, bigintReplacer),
    )
  })

  it('runs 500 seeded simulations in a bounded time', () => {
    const result = batch('performance', 500)
    expect(result.runs).toHaveLength(500)
    expect(result.durationMs).toBeLessThan(5_000)
  })
})

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}
