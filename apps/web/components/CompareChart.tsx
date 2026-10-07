'use client'

import type { CurveShapePoint } from '@preflight/metrics'

/**
 * Two curves on one pair of axes.
 *
 * Geometry only — no fees, no traders. The point is to see the shape decision
 * on its own, because the shape is what the outcome table underneath is
 * downstream of. Both curves are drawn against percentage of the raise rather
 * than absolute quote, so two different thresholds are still comparable.
 *
 * B is dashed as well as differently coloured: the pair passes the colour-vision
 * checks on its own, but a line chart read at a glance should not need them to.
 */

const W = 900
const H = 220
const PAD = { left: 54, right: 16, top: 10, bottom: 26 }

export function CompareChart({
  a,
  b,
  quoteSymbol,
}: {
  a: readonly CurveShapePoint[]
  b: readonly CurveShapePoint[]
  quoteSymbol: string
}) {
  const all = [...a, ...b]
  if (all.length === 0) return <div className="empty">Neither configuration produced a curve.</div>

  const lo = Math.min(...all.map((point) => point.price))
  const hi = Math.max(...all.map((point) => point.price))
  const span = hi - lo || 1

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (progress: number) => PAD.left + progress * plotW
  const y = (price: number) => PAD.top + plotH - ((price - lo) / span) * plotH

  const path = (points: readonly CurveShapePoint[]) =>
    points
      .map((point, i) => `${i === 0 ? 'M' : 'L'}${x(point.progress)} ${y(point.price)}`)
      .join(' ')

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => lo + fraction * span)

  return (
    <figure className="compare-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Both curves, overlaid">
        {ticks.map((price) => (
          <g key={price}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(price)}
              y2={y(price)}
              stroke="var(--line)"
              strokeWidth="1"
            />
            <text x={PAD.left - 9} y={y(price) + 3.5} textAnchor="end" className="ax">
              {price.toExponential(1)}
            </text>
          </g>
        ))}

        <path d={path(a)} fill="none" stroke="var(--c1)" strokeWidth="2" />
        <path d={path(b)} fill="none" stroke="var(--c2)" strokeWidth="2" strokeDasharray="7 5" />

        <text x={PAD.left} y={H - 8} className="ax">
          0%
        </text>
        <text x={W - PAD.right} y={H - 8} textAnchor="end" className="ax">
          graduation
        </text>
      </svg>

      <figcaption>
        <span className="key">
          <span className="rule a" /> Configuration A
        </span>
        <span className="key">
          <span className="rule b" /> Configuration B
        </span>
        <span className="axis-note">price per token, in {quoteSymbol}, against % of the raise</span>
      </figcaption>
    </figure>
  )
}
