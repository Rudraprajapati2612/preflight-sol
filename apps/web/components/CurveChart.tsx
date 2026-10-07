'use client'

import { useId, useState } from 'react'
import type { CurveShapePoint } from '@preflight/metrics'

/**
 * The curve a launcher is actually choosing.
 *
 * A DBC configuration is a list of square-root prices and thirty-digit
 * liquidity values, which says nothing about whether the price doubles in the
 * first tenth of the raise or the last. This draws that, which is the single
 * most useful thing the tool can put on screen.
 *
 * One series, so no legend — the caption names it. The shaded band marks the
 * portion of the raise where the price is still within 2× of where it opened:
 * the window an early buyer is competing for.
 */
export function CurveChart({
  shape,
  quoteSymbol,
  quoteDecimals,
}: {
  shape: readonly CurveShapePoint[]
  quoteSymbol: string
  quoteDecimals: number
}) {
  const gradientId = useId()
  const [hover, setHover] = useState<number | null>(null)

  if (shape.length < 3) return <div className="empty">No curve to draw.</div>

  const W = 780
  const H = 300
  const pad = { top: 16, right: 18, bottom: 32, left: 74 }
  const pw = W - pad.left - pad.right
  const ph = H - pad.top - pad.bottom

  const prices = shape.map((p) => p.price)
  const maxPrice = Math.max(...prices)
  const minPrice = Math.min(...prices)
  const open = prices[0] ?? 0

  const x = (p: CurveShapePoint) => pad.left + p.progress * pw
  const y = (price: number) => pad.top + ph - ((price - minPrice) / (maxPrice - minPrice || 1)) * ph

  const line = shape.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p)},${y(p.price)}`).join(' ')
  const area = `${line} L${pad.left + pw},${pad.top + ph} L${pad.left},${pad.top + ph} Z`

  // Where the price is still under 2× the open.
  const cheapUntil = shape.find((p) => p.price > open * 2) ?? shape.at(-1)!
  const active = hover === null ? null : shape[hover]

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => minPrice + t * (maxPrice - minPrice))

  return (
    <figure style={{ margin: 0 }}>
      <figcaption>
        Price per token against the raise — the shape of the curve itself, before any fees
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`The curve opens at ${fmt(open)} and reaches ${fmt(maxPrice)} ${quoteSymbol} at graduation.`}
        onMouseLeave={() => setHover(null)}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {ticks.map((value, i) => (
          <g key={i}>
            <line
              x1={pad.left}
              x2={pad.left + pw}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--line)"
            />
            <text
              x={pad.left - 10}
              y={y(value) + 4}
              textAnchor="end"
              fontSize="10.5"
              fill="var(--ink-4)"
              fontFamily="var(--mono)"
            >
              {fmt(value)}
            </text>
          </g>
        ))}

        {/* The stretch of the raise still priced under 2× the open. */}
        <rect
          x={pad.left}
          y={pad.top}
          width={Math.max(0, x(cheapUntil) - pad.left)}
          height={ph}
          fill="var(--brand)"
          opacity="0.05"
        />
        <line
          x1={x(cheapUntil)}
          x2={x(cheapUntil)}
          y1={pad.top}
          y2={pad.top + ph}
          stroke="var(--brand-3)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        <text x={x(cheapUntil) + 7} y={pad.top + 13} fontSize="10.5" fill="var(--brand-2)">
          {(cheapUntil.progress * 100).toFixed(0)}% of the raise is under 2×
        </text>

        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke="var(--brand)"
          strokeWidth="2.25"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {active && hover !== null && (
          <g>
            <line
              x1={x(active)}
              x2={x(active)}
              y1={pad.top}
              y2={pad.top + ph}
              stroke="var(--line)"
            />
            <circle
              cx={x(active)}
              cy={y(active.price)}
              r="4.5"
              fill="var(--brand-2)"
              stroke="var(--panel)"
              strokeWidth="2.5"
            />
          </g>
        )}

        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <text
            key={t}
            x={pad.left + t * pw}
            y={H - 10}
            textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'}
            fontSize="10.5"
            fill="var(--ink-4)"
            fontFamily="var(--mono)"
          >
            {t === 1 ? 'graduation' : `${(t * 100).toFixed(0)}%`}
          </text>
        ))}

        {shape.map((point, i) => (
          <rect
            key={i}
            x={x(point) - pw / shape.length / 2}
            y={pad.top}
            width={Math.max(4, pw / shape.length)}
            height={ph}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      <div
        style={{
          marginTop: 8,
          fontSize: 12.5,
          color: 'var(--ink-3)',
          fontFamily: 'var(--mono)',
          minHeight: 19,
        }}
      >
        {active
          ? `${fmt(active.price)} ${quoteSymbol} · ${(active.progress * 100).toFixed(0)}% raised · ${whole(active.quoteRaised, quoteDecimals)} ${quoteSymbol} in`
          : `opens ${fmt(open)} → graduates ${fmt(maxPrice)} ${quoteSymbol} · ${(maxPrice / (open || 1)).toFixed(1)}× along the curve`}
      </div>
    </figure>
  )
}

function fmt(value: number): string {
  if (value === 0) return '0'
  if (value < 1e-6) return value.toExponential(1)
  if (value < 1) return value.toPrecision(3)
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function whole(atomic: bigint, decimals: number): string {
  return (Number(atomic) / 10 ** decimals).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })
}
