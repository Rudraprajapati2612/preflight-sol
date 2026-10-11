import { baselineConfig, SOL, validateLaunchConfig } from '@preflight/config'
import { aggregateBatch, type BatchReport, type BatchScorecard } from '@preflight/metrics'
import { organic, type ScenarioParticipant } from '@preflight/agents'
import { describe, expect, it } from 'vitest'

import { generateCandidates, rankCandidates, tuneLaunch } from '../src/index.js'

const participants: readonly ScenarioParticipant[] = [
  {
    agent: organic('organic-1', {
      minSize: 100_000_000n,
      maxSize: 400_000_000n,
      sellChance: 0.2,
      activity: 0.7,
    }),
    funding: 5_000_000_000n,
  },
]

const input = () => ({
  baseline: baselineConfig(),
  searchSpace: { startingFeeBps: [100, 300], creatorTradingFeePercentage: [0, 40] },
  baseSeed: 'tuner-test',
  runs: 2,
  objective: { kind: 'minimize-average-slippage' } as const,
  participants,
  quoteAsset: SOL,
  baseDecimals: 6,
  maxSteps: 20,
})

describe('generateCandidates', () => {
  it('includes the baseline once and eliminates duplicate grid values', () => {
    const candidates = generateCandidates(baselineConfig(), {
      startingFeeBps: [100, 100, 300],
      creatorTradingFeePercentage: [0, 0],
    })
    expect(candidates).toHaveLength(2)
    expect(candidates.filter((candidate) => candidate.isBaseline)).toHaveLength(1)
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      'startingFeeBps=100|creatorTradingFeePercentage=0',
      'startingFeeBps=300|creatorTradingFeePercentage=0',
    ])
  })

  it('keeps invalid grid values for validation instead of simulating them', () => {
    const [candidate] = generateCandidates(baselineConfig(), {
      creatorTradingFeePercentage: [150],
    }).filter((item) => !item.isBaseline)
    expect(validateLaunchConfig(candidate!.config).valid).toBe(false)
  })

  it('rejects empty search spaces and oversized grids', () => {
    expect(() => generateCandidates(baselineConfig(), {})).toThrow('at least one')
    expect(() => generateCandidates(baselineConfig(), { startingFeeBps: [] })).toThrow(
      'must not be empty',
    )
    expect(() =>
      generateCandidates(baselineConfig(), { startingFeeBps: [100, 200, 300] }, 2),
    ).toThrow('above the maximum')
  })
})

describe('ranking', () => {
  const validation = validateLaunchConfig(baselineConfig())

  it('ranks hand-checkable single objectives and breaks ties by stable candidate id', () => {
    const ranked = rankCandidates(
      [
        {
          id: 'b',
          scorecard: card({ averageSlippage: 0.1 }),
          validation,
          constraints: { feasible: true, violations: [] },
        },
        {
          id: 'a',
          scorecard: card({ averageSlippage: 0.1 }),
          validation,
          constraints: { feasible: true, violations: [] },
        },
        {
          id: 'c',
          scorecard: card({ averageSlippage: 0.2 }),
          validation,
          constraints: { feasible: true, violations: [] },
        },
      ],
      { kind: 'minimize-average-slippage' },
    )
    expect(ranked).toEqual([
      { id: 'b', objectiveValue: -0.1, rank: 2 },
      { id: 'a', objectiveValue: -0.1, rank: 1 },
      { id: 'c', objectiveValue: -0.2, rank: 3 },
    ])
  })

  it('normalizes metrics before applying weighted objectives', () => {
    const ranked = rankCandidates(
      [
        {
          id: 'graduation',
          scorecard: card({ graduated: true, averageSlippage: 0.9 }),
          validation,
          constraints: { feasible: true, violations: [] },
        },
        {
          id: 'slippage',
          scorecard: card({ graduated: false, averageSlippage: 0.1 }),
          validation,
          constraints: { feasible: true, violations: [] },
        },
      ],
      { kind: 'weighted', weights: { graduationProbability: 3, averageSlippage: 1 } },
    )
    expect(ranked).toEqual([
      { id: 'graduation', objectiveValue: 0.75, rank: 1 },
      { id: 'slippage', objectiveValue: 0.25, rank: 2 },
    ])
  })
})

describe('tuneLaunch', () => {
  it('is deterministic and gives each candidate the same derived seed set', () => {
    const a = tuneLaunch(input())
    const b = tuneLaunch(input())
    expect(a.seedSet).toEqual(['tuner-test:0', 'tuner-test:1'])
    expect(a.seedSet).toEqual(b.seedSet)
    expect(a.candidates.map(compact)).toEqual(b.candidates.map(compact))
    expect(
      a.candidates.every((candidate) =>
        candidate.rawRuns.every((run) => run.seed.startsWith('tuner-test:')),
      ),
    ).toBe(true)
  })

  it('enforces constraints and returns no recommendation when none is feasible', () => {
    const report = tuneLaunch({
      ...input(),
      constraints: { minimumGraduationProbability: 1 },
    })
    expect(report.recommended).toBeNull()
    expect(report.candidates.every((candidate) => !candidate.constraints.feasible)).toBe(true)
    expect(report.explanation).toContain('No feasible recommendation')
  })

  it('rejects a simulation budget that would make the search unbounded', () => {
    expect(() => tuneLaunch({ ...input(), maxEvaluations: 3 })).toThrow('evaluation budget')
  })
})

function compact(candidate: ReturnType<typeof tuneLaunch>['candidates'][number]) {
  return {
    id: candidate.id,
    rank: candidate.rank,
    objectiveValue: candidate.objectiveValue,
    score: candidate.score,
    feasible: candidate.constraints.feasible,
  }
}

function card(overrides: Partial<BatchScorecard> = {}): BatchReport {
  return aggregateBatch([
    {
      graduated: false,
      timeToGraduationSeconds: null,
      concentration: { sniperShare: 0.2, topHolderShare: 0.3, topFiveShare: 0.5, topTenShare: 0.7 },
      feesToCreator: { quote: 10n, base: 0n },
      averageSlippage: 0.2,
      worstSlippage: 0.4,
      ...overrides,
    },
  ])
}
