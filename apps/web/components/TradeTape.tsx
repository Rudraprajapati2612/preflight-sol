'use client'

import { useState } from 'react'

import type { TapeRow } from '../lib/simulate'

/**
 * Every trade, in the order it executed.
 *
 * The summary statistics say what a launch came to; this says what it did. A
 * sniper buying a third of the float at t=0 and selling it back at t=41 is one
 * line here and is invisible in every aggregate on the page, which is exactly
 * the kind of event a launcher needs to see before it happens with real money.
 */

/**
 * The three categorical slots, in the assignment the palette was validated in:
 * every pair is separable under each colour-vision deficiency against this
 * surface. A fourth archetype would need the palette re-checked, not a fourth
 * hue invented.
 */
export const ARCHETYPE_COLOUR: Record<string, string> = {
  sniper: 'var(--c2)',
  whale: 'var(--c1)',
  organic: 'var(--c3)',
}

export function TradeTape({
  rows,
  quoteSymbol,
  quoteDecimals,
}: {
  rows: readonly TapeRow[]
  quoteSymbol: string
  quoteDecimals: number
}) {
  const [filter, setFilter] = useState<string | null>(null)

  const archetypes = [...new Set(rows.map((row) => row.archetype))]
  const shown = filter ? rows.filter((row) => row.archetype === filter) : rows

  if (rows.length === 0) {
    return <div className="empty">No trade executed, so there is no tape.</div>
  }

  return (
    <>
      <div className="tape-filters">
        <button aria-pressed={filter === null} onClick={() => setFilter(null)}>
          All {rows.length}
        </button>
        {archetypes.map((archetype) => (
          <button
            key={archetype}
            aria-pressed={filter === archetype}
            onClick={() => setFilter(filter === archetype ? null : archetype)}
          >
            <span className="swatch" style={{ background: ARCHETYPE_COLOUR[archetype] }} />
            {archetype}
          </button>
        ))}
      </div>

      <div className="tape-scroll">
        <table className="tape">
          <thead>
            <tr>
              <th>#</th>
              <th>T+</th>
              <th>Actor</th>
              <th>Side</th>
              <th className="r">In</th>
              <th className="r">Out</th>
              <th className="r">Price</th>
              <th className="r">Raised</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              // Under a buy the input is quote and the output is base; a sell
              // is the reverse. Labelling both in the quote asset would price
              // a token amount in SOL.
              const inDecimals = row.side === 'buy' ? quoteDecimals : 6
              const outDecimals = row.side === 'buy' ? 6 : quoteDecimals
              const inUnit = row.side === 'buy' ? quoteSymbol : ''
              const outUnit = row.side === 'buy' ? '' : quoteSymbol

              return (
                <tr key={row.step}>
                  <td className="dim">{String(row.step).padStart(3, '0')}</td>
                  <td className="dim">{elapsed(row.at)}</td>
                  <td>
                    <span
                      className="swatch"
                      style={{ background: ARCHETYPE_COLOUR[row.archetype] }}
                    />
                    {row.actor}
                  </td>
                  <td className={row.side === 'buy' ? 'buy' : 'sell'}>
                    {row.side.toUpperCase()}
                    {row.partialFill && (
                      <span className="pf" title="Partially filled">
                        ·
                      </span>
                    )}
                  </td>
                  <td className="r">
                    {amount(row.amountIn, inDecimals)}
                    {inUnit && <span className="unit"> {inUnit}</span>}
                  </td>
                  <td className="r">
                    {amount(row.amountOut, outDecimals)}
                    {outUnit && <span className="unit"> {outUnit}</span>}
                  </td>
                  <td className="r">{row.price.toExponential(1)}</td>
                  <td className="r">{amount(row.raised, quoteDecimals)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function elapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

/** Compact enough for a dense row without losing the order of magnitude. */
function amount(atomic: bigint, decimals: number): string {
  const value = Number(atomic) / 10 ** decimals
  if (value === 0) return '0'
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (value >= 1) return value.toFixed(2)
  return value.toPrecision(3)
}
