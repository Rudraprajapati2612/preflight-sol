'use client'

import { useMemo, useState } from 'react'

import { CompareChart } from '../../components/CompareChart'
import { Nav } from '../../components/Nav'
import { ARCHETYPE_COLOUR } from '../../components/TradeTape'
import { Workflow } from '../../components/Workflow'
import {
  DEFAULT_INPUTS,
  type LaunchInputs,
  simulate,
  type SimulationOutput,
} from '../../lib/simulate'

/**
 * Two configurations, one launch.
 *
 * The seed, the quote asset, the supply and the crowd are forced to match
 * across both sides and cannot be set here. That is the whole point: if any of
 * them could differ, a difference in the table below would have two possible
 * causes and would answer nothing. What is left adjustable is the
 * configuration, so every row is attributable to it.
 */
export default function Compare() {
  const [a, setA] = useState<LaunchInputs>(DEFAULT_INPUTS)
  const [b, setB] = useState<LaunchInputs>({
    ...DEFAULT_INPUTS,
    percentageSupplyOnMigration: 40,
    startingFeeBps: 400,
    feeDecay: { mode: 'linear', endingFeeBps: 100, durationSeconds: 600, periods: 60 },
  })

  const runA = useRun(a)
  const runB = useRun(b)

  return (
    <>
      <Nav app seed={a.seed} />
      <div className="wrap app">
        <Workflow phase="Compare" />

        <div className="compare-head">
          <div>
            <h1>Two curves, one launch</h1>
            <p>
              Both run on seed <code>{a.seed}</code> against the same participants, so every
              difference below is the configuration.
            </p>
          </div>
          <button className="btn btn-ghost" onClick={() => setB(a)}>
            Reset B to A
          </button>
        </div>

        {runA.ok && runB.ok ? (
          <div className="stack">
            <section className="panel">
              <header>
                <h2>Both curves, overlaid</h2>
                <span className="note">
                  geometry only — fees and participants move the table, not this shape
                </span>
              </header>
              <CompareChart
                a={runA.value.shape}
                b={runB.value.shape}
                quoteSymbol={runA.value.quoteAsset.symbol}
              />
            </section>

            <div className="grid-2">
              <Column label="A" colour="var(--c1)" inputs={a} onChange={setA} run={runA.value} />
              <Column label="B" colour="var(--c2)" inputs={b} onChange={setB} run={runB.value} />
            </div>

            <section className="panel">
              <header>
                <h2>Difference</h2>
                <span className="note">B relative to A</span>
              </header>
              <DifferenceTable a={runA.value} b={runB.value} />
            </section>
          </div>
        ) : (
          <section className="panel">
            <header>
              <h2>The program would reject one of these</h2>
            </header>
            <p className="prose">{(!runA.ok && runA.error) || (!runB.ok && runB.error)}</p>
          </section>
        )}
      </div>
    </>
  )
}

function useRun(inputs: LaunchInputs) {
  return useMemo(() => {
    try {
      return { ok: true as const, value: simulate(inputs) }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  }, [inputs])
}

/* ------------------------------------------------------------------ column */

function Column({
  label,
  colour,
  inputs,
  onChange,
  run,
}: {
  label: string
  colour: string
  inputs: LaunchInputs
  onChange: (inputs: LaunchInputs) => void
  run: SimulationOutput
}) {
  const q = run.quoteAsset.symbol
  const set = <K extends keyof LaunchInputs>(key: K, value: LaunchInputs[K]) =>
    onChange({ ...inputs, [key]: value })

  return (
    <section className="panel">
      <header>
        <h2>
          <span className="rule" style={{ background: colour }} />
          Configuration {label}
        </h2>
      </header>

      <Row
        label="Graduates at"
        value={`${inputs.migrationQuoteThreshold} ${q}`}
        min={5}
        max={500}
        step={5}
        raw={inputs.migrationQuoteThreshold}
        colour={colour}
        onChange={(v) => set('migrationQuoteThreshold', v)}
      />
      <Row
        label="Held back for the pool"
        value={`${inputs.percentageSupplyOnMigration}% of supply`}
        min={5}
        max={45}
        step={5}
        raw={inputs.percentageSupplyOnMigration}
        colour={colour}
        onChange={(v) => set('percentageSupplyOnMigration', v)}
      />
      <Row
        label="Opening fee"
        value={`${(inputs.startingFeeBps / 100).toFixed(2)}%`}
        min={25}
        max={1000}
        step={25}
        raw={inputs.startingFeeBps}
        colour={colour}
        onChange={(v) =>
          onChange({
            ...inputs,
            startingFeeBps: v,
            feeDecay: inputs.feeDecay
              ? { ...inputs.feeDecay, endingFeeBps: Math.min(inputs.feeDecay.endingFeeBps, v) }
              : null,
          })
        }
      />
      <Row
        label="Decays over"
        value={
          inputs.feeDecay
            ? `${Math.round(inputs.feeDecay.durationSeconds / 60)} min`
            : 'flat — no decay'
        }
        min={0}
        max={3600}
        step={60}
        raw={inputs.feeDecay?.durationSeconds ?? 0}
        colour={colour}
        onChange={(v) =>
          set(
            'feeDecay',
            v === 0
              ? null
              : {
                  mode: 'linear',
                  endingFeeBps: Math.min(
                    inputs.feeDecay?.endingFeeBps ?? 100,
                    inputs.startingFeeBps,
                  ),
                  durationSeconds: v,
                  periods: 60,
                },
          )
        }
      />

      <div className="split-bar" style={{ marginTop: 20 }}>
        {run.groups
          .filter((group) => group.share > 0)
          .map((group) => (
            <span
              key={group.archetype}
              title={`${group.archetype}: ${(group.share * 100).toFixed(1)}%`}
              style={{
                width: `${group.share * 100}%`,
                background: ARCHETYPE_COLOUR[group.archetype] ?? 'var(--ink-4)',
              }}
            />
          ))}
      </div>
      <p className="caption">
        {run.report.graduated
          ? `Graduated in ${duration(run.report.timeToGraduationSeconds ?? 0n)}`
          : 'Never graduated'}
        {' · '}
        largest holder {(run.report.concentration.topHolderShare * 100).toFixed(0)}%{' · '}
        {run.report.trades} trades
      </p>
    </section>
  )
}

function Row({
  label,
  value,
  raw,
  min,
  max,
  step,
  colour,
  onChange,
}: {
  label: string
  value: string
  raw: number
  min: number
  max: number
  step: number
  colour: string
  onChange: (value: number) => void
}) {
  return (
    <div className="field compare-field">
      <div className="label">
        <span>{label}</span>
        <span className="val">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={raw}
        style={{ accentColor: colour }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

/* -------------------------------------------------------------- difference */

function DifferenceTable({ a, b }: { a: SimulationOutput; b: SimulationOutput }) {
  const q = a.quoteAsset.symbol
  const dp = a.quoteAsset.decimals
  const sol = (atomic: bigint) => Number(atomic) / 10 ** dp

  const rows: {
    measure: string
    a: string
    b: string
    diff: string
    /** +1 when B is better than A, -1 when worse, 0 when it does not signify. */
    sign: number
  }[] = [
    {
      measure: 'Graduated',
      a: a.report.graduated ? 'yes' : 'no',
      b: b.report.graduated ? 'yes' : 'no',
      diff:
        a.report.graduated === b.report.graduated ? '—' : b.report.graduated ? 'B only' : 'A only',
      sign: a.report.graduated === b.report.graduated ? 0 : b.report.graduated ? 1 : -1,
    },
    num(
      'Time to graduation',
      Number(a.report.timeToGraduationSeconds ?? 0n),
      Number(b.report.timeToGraduationSeconds ?? 0n),
      (v) => duration(BigInt(Math.round(v))),
      0,
    ),
    num(
      'Fully diluted at graduation',
      a.derived.migrationMarketCap,
      b.derived.migrationMarketCap,
      (v) => `${v.toFixed(0)} ${q}`,
      0,
    ),
    num(
      'Largest holder',
      a.report.concentration.topHolderShare * 100,
      b.report.concentration.topHolderShare * 100,
      (v) => `${v.toFixed(1)}%`,
      -1,
    ),
    num(
      'Top five',
      a.report.concentration.topFiveShare * 100,
      b.report.concentration.topFiveShare * 100,
      (v) => `${v.toFixed(1)}%`,
      -1,
    ),
    num(
      'Snipers at their peak',
      (a.facts.snipers?.peakSupplyShare ?? 0) * 100,
      (b.facts.snipers?.peakSupplyShare ?? 0) * 100,
      (v) => `${v.toFixed(1)}%`,
      -1,
    ),
    num('Gini', a.report.concentration.gini, b.report.concentration.gini, (v) => v.toFixed(3), -1),
    num(
      'Holders',
      a.report.concentration.holders,
      b.report.concentration.holders,
      (v) => String(v),
      1,
    ),
    num(
      'Fees collected',
      sol(a.facts.fees.quote),
      sol(b.facts.fees.quote),
      (v) => `${v.toFixed(2)} ${q}`,
      0,
    ),
    num(
      'Average slippage',
      a.report.averageSlippage * 100,
      b.report.averageSlippage * 100,
      (v) => `${v.toFixed(1)}%`,
      -1,
    ),
    num('Volatility', a.report.volatility, b.report.volatility, (v) => v.toFixed(3), -1),
  ]

  return (
    <table className="data difference">
      <thead>
        <tr>
          <th>Measure</th>
          <th className="num">A</th>
          <th className="num">B</th>
          <th className="num">Difference</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.measure}>
            <td className="name">{row.measure}</td>
            <td className="num">{row.a}</td>
            <td className="num">{row.b}</td>
            <td className={`num ${row.sign > 0 ? 'ok' : row.sign < 0 ? 'worse' : ''}`}>
              {row.diff}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * One numeric row. `better` says which direction counts as an improvement; 0
 * means the measure has no better direction and the difference is stated
 * without being coloured as a verdict.
 */
function num(
  measure: string,
  av: number,
  bv: number,
  format: (value: number) => string,
  better: 1 | -1 | 0,
): { measure: string; a: string; b: string; diff: string; sign: number } {
  const difference = bv - av
  const moved = Math.abs(difference) > 1e-9
  return {
    measure,
    a: format(av),
    b: format(bv),
    diff: moved ? `${difference > 0 ? '+' : '−'}${format(Math.abs(difference))}` : '—',
    sign: !moved || better === 0 ? 0 : Math.sign(difference) === better ? 1 : -1,
  }
}

function duration(seconds: bigint): string {
  const total = Number(seconds)
  if (total === 0) return '—'
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m ${total % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
