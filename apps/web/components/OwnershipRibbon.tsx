'use client'

import { ARCHETYPE_COLOUR } from './TradeTape'
import type { TapeRow } from '../lib/simulate'

/**
 * Which stretch of the curve each group bought through.
 *
 * A holder breakdown says who owns the token; this says *where* they got it,
 * which is a different and more actionable fact. A band of sniper colour along
 * the first tenth of the curve means the cheap end of the curve was handed to
 * whoever was fastest — a property of the shape, fixable before launch.
 *
 * Only buys are drawn. A sell hands supply back rather than taking a stretch
 * of the curve, and colouring it would double-count the same ground.
 */
export function OwnershipRibbon({
  rows,
  migrationThreshold,
}: {
  rows: readonly TapeRow[]
  /** Quote that must be raised to graduate, in atomic units. */
  migrationThreshold: bigint
}) {
  if (migrationThreshold <= 0n || rows.length === 0) return null

  const scale = Number(migrationThreshold)
  const spans: { archetype: string; from: number; to: number }[] = []
  let previous = 0

  for (const row of rows) {
    const position = Math.min(1, Number(row.raised) / scale)
    if (row.side === 'buy' && position > previous) {
      const last = spans.at(-1)
      // Touching spans of the same group are merged, so the ribbon reads as
      // territory rather than as one stripe per trade.
      if (last && last.archetype === row.archetype && last.to === previous) last.to = position
      else spans.push({ archetype: row.archetype, from: previous, to: position })
    }
    previous = Math.max(previous, position)
  }

  if (spans.length === 0) return null
  const groups = [...new Set(spans.map((span) => span.archetype))]

  return (
    <figure className="ribbon">
      <div className="ribbon-track">
        {spans.map((span, index) => (
          <span
            key={index}
            title={`${span.archetype}: ${(span.from * 100).toFixed(0)}–${(span.to * 100).toFixed(0)}% of the raise`}
            style={{
              left: `${span.from * 100}%`,
              width: `${Math.max(0.2, (span.to - span.from) * 100)}%`,
              background: ARCHETYPE_COLOUR[span.archetype] ?? 'var(--ink-4)',
            }}
          />
        ))}
      </div>
      <figcaption>
        Who bought through which stretch of the raise.
        {groups.map((archetype) => (
          <span key={archetype} className="key">
            <span className="swatch" style={{ background: ARCHETYPE_COLOUR[archetype] }} />
            {archetype}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
