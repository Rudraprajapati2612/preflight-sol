import type { AgentState } from '@preflight/agents'

import { ratio } from './price.js'

/**
 * Who ended up owning the token.
 *
 * This is the measure a launcher most often gets wrong and most needs to see.
 * A curve can look healthy on a price chart while three wallets hold most of
 * the supply, and that is a property of the curve's shape — cheap early
 * segments hand the supply to whoever is fastest — not of bad luck.
 *
 * Every share is computed as an exact ratio of atomic amounts and converted to
 * a float once, at the end.
 */

export interface Concentration {
  /** Wallets holding any base token at the end of the run. */
  readonly holders: number
  /** Share of held supply owned by the largest single wallet, 0 to 1. */
  readonly topHolderShare: number
  /** Share held by the largest five wallets. */
  readonly topFiveShare: number
  /** Share held by wallets that acted as snipers. */
  readonly sniperShare: number
  /**
   * Gini coefficient of the holdings, 0 (everyone equal) to 1 (one wallet has
   * everything). Reported alongside the top-N shares because the two disagree
   * in informative ways: a launch can have a small top-five share and still be
   * very unequal across a long tail.
   */
  readonly gini: number
  /** Total base held by agents, in atomic units. */
  readonly totalHeld: bigint
}

export function concentration(agents: readonly AgentState[]): Concentration {
  const holdings = agents
    .filter((agent) => agent.baseBalance > 0n)
    .map((agent) => ({ balance: agent.baseBalance, archetype: agent.archetype }))

  const totalHeld = holdings.reduce((total, holding) => total + holding.balance, 0n)
  if (holdings.length === 0 || totalHeld === 0n) {
    return {
      holders: 0,
      topHolderShare: 0,
      topFiveShare: 0,
      sniperShare: 0,
      gini: 0,
      totalHeld: 0n,
    }
  }

  const descending = [...holdings].sort((a, b) =>
    a.balance === b.balance ? 0 : a.balance > b.balance ? -1 : 1,
  )
  const topN = (n: number): bigint =>
    descending.slice(0, n).reduce((total, holding) => total + holding.balance, 0n)

  const sniperHeld = holdings
    .filter((holding) => holding.archetype === 'sniper')
    .reduce((total, holding) => total + holding.balance, 0n)

  return {
    holders: holdings.length,
    topHolderShare: ratio(topN(1), totalHeld),
    topFiveShare: ratio(topN(5), totalHeld),
    sniperShare: ratio(sniperHeld, totalHeld),
    gini: gini(holdings.map((holding) => holding.balance)),
    totalHeld,
  }
}

/**
 * Gini coefficient over exact amounts.
 *
 * Uses the ordered form `G = (2 * Σ i·x_i) / (n · Σ x_i) − (n + 1) / n` with the
 * holdings sorted ascending. The weighted sum is accumulated in `bigint`, so a
 * long tail of small holders cannot be rounded away before it is counted.
 */
export function gini(amounts: readonly bigint[]): number {
  const sorted = [...amounts].sort((a, b) => (a === b ? 0 : a > b ? 1 : -1))
  const n = sorted.length
  if (n === 0) return 0
  if (n === 1) return 0

  let total = 0n
  let weighted = 0n
  for (const [index, amount] of sorted.entries()) {
    total += amount
    weighted += BigInt(index + 1) * amount
  }
  if (total === 0n) return 0

  const value = ratio(2n * weighted, BigInt(n) * total) - (n + 1) / n
  // Clamp: the formula can land a hair outside [0, 1] from the final division.
  return Math.min(1, Math.max(0, value))
}
