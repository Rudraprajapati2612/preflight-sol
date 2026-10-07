'use client'

import type { AgentState } from '@preflight/agents'

/**
 * Who ended up holding the token.
 *
 * A stacked bar rather than a pie: people compare lengths far better than
 * angles, and the question here is comparative — did one group take most of
 * it. Colours come from the validated categorical slots, and every segment is
 * also named in the table below, so identity never rests on colour alone.
 */

import { ARCHETYPE_COLOUR as COLOUR } from './TradeTape'

export function HolderChart({
  agents,
  baseDecimals,
}: {
  agents: readonly AgentState[]
  baseDecimals: number
}) {
  const holders = agents.filter((agent) => agent.baseBalance > 0n)
  const total = holders.reduce((sum, agent) => sum + agent.baseBalance, 0n)

  if (total === 0n) {
    return (
      <div style={{ color: 'var(--ink-3)', fontSize: 13.5, padding: '10px 0' }}>
        Nobody is holding the token: no trade completed.
      </div>
    )
  }

  const byArchetype = new Map<string, bigint>()
  for (const agent of holders) {
    byArchetype.set(agent.archetype, (byArchetype.get(agent.archetype) ?? 0n) + agent.baseBalance)
  }

  const groups = [...byArchetype.entries()]
    .map(([archetype, amount]) => ({
      archetype,
      amount,
      share: Number((amount * 10_000n) / total) / 100,
    }))
    .sort((a, b) => b.share - a.share)

  return (
    <div>
      {/* 2px gaps between segments, so adjacent fills stay separable. */}
      <div style={{ display: 'flex', gap: 2, height: 12, marginBottom: 16 }}>
        {groups.map((group) => (
          <div
            key={group.archetype}
            title={`${group.archetype}: ${group.share.toFixed(1)}%`}
            style={{
              width: `${group.share}%`,
              background: COLOUR[group.archetype] ?? 'var(--ink-3)',
              borderRadius: 4,
            }}
          />
        ))}
      </div>

      <table className="data">
        <thead>
          <tr>
            <th>Group</th>
            <th style={{ textAlign: 'right' }}>Share</th>
            <th style={{ textAlign: 'right' }}>Tokens</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.archetype}>
              <td className="name">
                <span
                  className="swatch"
                  style={{ background: COLOUR[group.archetype] ?? 'var(--ink-3)' }}
                />
                {group.archetype}
              </td>
              <td className="num">{group.share.toFixed(1)}%</td>
              <td className="num">{whole(group.amount, baseDecimals)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function whole(atomic: bigint, decimals: number): string {
  const value = Number(atomic / 10n ** BigInt(decimals))
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
}
