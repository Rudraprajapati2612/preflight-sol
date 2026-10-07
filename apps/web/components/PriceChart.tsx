'use client'

import { useId, useState } from 'react'
import type { Candle } from '@preflight/metrics'

/**
 * The price path of a launch.
 *
 * One series, so no legend: the title names it. The line is the brand violet
 * rather than a categorical hue, which is safe precisely because it is alone —
 * it sits too close to the categorical blue to appear beside it.
 */
export function PriceChart({
  candles,
  quoteSymbol,
  migrationPrice,
}: {
  candles: readonly Candle[]
  quoteSymbol: string
  migrationPrice: number
}) {
  const clipId = useId()
  const [hover, setHover] = useState<number | null>(null)

  if (candles.length < 2) {
    return <Empty>Not enough trades to plot a price path.</Empty>
  }

  const width = 760
  const height = 260
  const pad = { top: 14, right: 16, bottom: 26, left: 62 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom

  const lows = candles.map((c) => c.low)
  const highs = candles.map((c) => c.high)
  const minY = Math.min(...lows)
  const maxY = Math.max(...highs, migrationPrice)
  const span = maxY - minY || maxY || 1

  const x = (i: number) => pad.left + (i / (candles.length - 1)) * plotW
  const y = (v: number) => pad.top + plotH - ((v - minY) / span) * plotH

  const line = candles.map((c, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(c.close)}`).join(' ')
  const area = `${line} L${x(candles.length - 1)},${pad.top + plotH} L${x(0)},${pad.top + plotH} Z`

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => minY + t * span)
  const active = hover === null ? null : candles[hover]

  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 10 }}>
        Price per token, in {quoteSymbol}
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={`Price rose from ${fmt(candles[0]!.open)} to ${fmt(candles.at(-1)!.close)} ${quoteSymbol}`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={clipId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((value) => (
          <g key={value}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--line)"
              strokeWidth="1"
            />
            <text
              x={pad.left - 9}
              y={y(value) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--ink-3)"
              fontFamily="var(--mono)"
            >
              {fmt(value)}
            </text>
          </g>
        ))}

        {/* Where the curve graduates. Labelled directly, because a bare line
            would be one more thing to decode from a legend. */}
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={y(migrationPrice)}
          y2={y(migrationPrice)}
          stroke="var(--good)"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        <text
          x={width - pad.right}
          y={y(migrationPrice) - 6}
          textAnchor="end"
          fontSize="11"
          fill="var(--good)"
        >
          migration
        </text>

        <path d={area} fill={`url(#${clipId})`} />
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" />

        {active && hover !== null && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="var(--line-2)"
              strokeWidth="1"
            />
            <circle
              cx={x(hover)}
              cy={y(active.close)}
              r="4.5"
              fill="var(--brand)"
              stroke="var(--panel-2)"
              strokeWidth="2"
            />
          </g>
        )}

        {candles.map((candle, i) => (
          <rect
            key={candle.timestamp.toString()}
            x={x(i) - plotW / candles.length / 2}
            y={pad.top}
            width={Math.max(6, plotW / candles.length)}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      <div style={{ height: 20, fontSize: 12.5, color: 'var(--ink-2)', marginTop: 4 }}>
        {active
          ? `${fmt(active.close)} ${quoteSymbol} · high ${fmt(active.high)} · low ${fmt(active.low)}`
          : 'Hover the chart for a point in the launch.'}
      </div>
    </figure>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '38px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5 }}>
      {children}
    </div>
  )
}

function fmt(value: number): string {
  if (value === 0) return '0'
  if (value < 0.000001) return value.toExponential(2)
  if (value < 1) return value.toPrecision(3)
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
