'use client'

import { useMemo, useState } from 'react'

import { CurveChart } from '../../components/CurveChart'
import { ExportConfig } from '../../components/ExportConfig'
import { Nav } from '../../components/Nav'
import { OwnershipRibbon } from '../../components/OwnershipRibbon'
import { PriceChart } from '../../components/PriceChart'
import { ARCHETYPE_COLOUR, TradeTape } from '../../components/TradeTape'
import { Workflow } from '../../components/Workflow'
import { SCENARIOS, scenarioFor } from '../../lib/scenarios'
import {
  crowdOf,
  DEFAULT_INPUTS,
  DEFAULT_THRESHOLD,
  type LaunchInputs,
  type QuoteKey,
  simulate,
  type SimulationOutput,
} from '../../lib/simulate'

/** Plausible raises per quote asset. 50 SOL and 50 USDC are not the same sum. */
const THRESHOLD_RANGE: Record<QuoteKey, { min: number; max: number; step: number }> = {
  SOL: { min: 5, max: 500, step: 5 },
  USDC: { min: 1_000, max: 100_000, step: 1_000 },
  AAPLx: { min: 100, max: 5_000, step: 50 },
}

export default function Simulator() {
  const [inputs, setInputs] = useState<LaunchInputs>(DEFAULT_INPUTS)
  // The baseline is pinned to the opening configuration, so every number on
  // screen has something to be a change from. Comparing against the previous
  // keystroke instead would make a dragged slider report noise.
  const [baseline, setBaseline] = useState<{ inputs: LaunchInputs; run: SimulationOutput } | null>(
    () => {
      try {
        return { inputs: DEFAULT_INPUTS, run: simulate(DEFAULT_INPUTS) }
      } catch {
        return null
      }
    },
  )

  // Fast enough to re-run as the form changes: there is no button because
  // there is no wait worth announcing.
  const outcome = useMemo(() => {
    try {
      return { ok: true as const, value: simulate(inputs) }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  }, [inputs])

  const set = <K extends keyof LaunchInputs>(key: K, value: LaunchInputs[K]) =>
    setInputs((current) => ({ ...current, [key]: value }))

  const changes = baseline ? describeChanges(baseline.inputs, inputs) : []

  return (
    <>
      <Nav app seed={inputs.seed} />
      <div className="wrap app">
        <Workflow phase={phaseOf(changes)} />

        <div className="layout">
          <ConfigRail inputs={inputs} set={set} setInputs={setInputs} />

          <main className="stack">
            <Scenarios inputs={inputs} setInputs={setInputs} />

            {!outcome.ok ? (
              <section className="panel">
                <header>
                  <h2>The program would reject this configuration</h2>
                </header>
                <p className="prose">{outcome.error}</p>
                <p className="prose" style={{ marginTop: 10 }}>
                  Nothing was simulated. Meteora&rsquo;s own validator refused to build the curve,
                  which is the same answer you would get from <code>create_config</code> on chain.
                </p>
              </section>
            ) : (
              <Results
                run={outcome.value}
                baseline={baseline}
                changes={changes}
                onPin={() => setBaseline({ inputs, run: outcome.value })}
                onReset={() => baseline && setInputs(baseline.inputs)}
              />
            )}
          </main>

          {outcome.ok && (
            <Readout run={outcome.value} before={changes.length > 0 ? baseline?.run : undefined} />
          )}
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ config */

function ConfigRail({
  inputs,
  set,
  setInputs,
}: {
  inputs: LaunchInputs
  set: <K extends keyof LaunchInputs>(key: K, value: LaunchInputs[K]) => void
  setInputs: (update: (current: LaunchInputs) => LaunchInputs) => void
}) {
  const symbol = inputs.quote
  const range = THRESHOLD_RANGE[inputs.quote]

  return (
    <aside className="rail">
      <Group
        title="The market"
        caption="What is being sold, in what, and how much of it reaches the curve."
      >
        <Field
          label="Priced in"
          hint={
            inputs.quote === 'AAPLx'
              ? 'A tokenized equity. Any SPL mint can price a launch — but this one is Token-2022, and the program treats that differently.'
              : 'The curve does not care what it is priced in; only the decimals change.'
          }
        >
          <Seg
            options={['SOL', 'USDC', 'AAPLx'] as const}
            value={inputs.quote}
            onChange={(key) =>
              setInputs((current) => ({
                ...current,
                quote: key,
                migrationQuoteThreshold: DEFAULT_THRESHOLD[key],
              }))
            }
          />
        </Field>

        <Field label="Total supply">
          <Seg
            options={[100_000_000, 1_000_000_000, 10_000_000_000] as const}
            labels={['100M', '1B', '10B']}
            value={inputs.totalTokenSupply}
            onChange={(value) => set('totalTokenSupply', value)}
          />
        </Field>

        <Slider
          label="Graduates at"
          value={inputs.migrationQuoteThreshold}
          min={range.min}
          max={range.max}
          step={range.step}
          format={(v) => `${v.toLocaleString()} ${symbol}`}
          onChange={(v) => set('migrationQuoteThreshold', v)}
          hint="Quote raised before liquidity leaves the curve for a DAMM pool."
        />

        <Slider
          label="Held back for the pool"
          value={inputs.percentageSupplyOnMigration}
          min={5}
          max={45}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => set('percentageSupplyOnMigration', v)}
          hint="Supply seeded into the graduated pool instead of sold on the curve. Holding back more means the same raise has to come out of a steeper climb."
        />
      </Group>

      <Group
        title="The defence"
        caption="What being early costs, and whether that cost falls away."
      >
        <Slider
          label="Opening fee"
          value={inputs.startingFeeBps}
          min={25}
          max={1000}
          step={25}
          format={(v) => `${(v / 100).toFixed(2)}%`}
          onChange={(v) =>
            setInputs((current) => ({
              ...current,
              startingFeeBps: v,
              feeDecay: current.feeDecay
                ? { ...current.feeDecay, endingFeeBps: Math.min(current.feeDecay.endingFeeBps, v) }
                : null,
            }))
          }
          hint="The lever against snipers: a high opening fee makes being first expensive."
        />

        <Toggle
          label="Fee decays over time"
          checked={inputs.feeDecay !== null}
          onChange={(on) =>
            set(
              'feeDecay',
              on
                ? {
                    mode: 'linear',
                    endingFeeBps: Math.min(100, inputs.startingFeeBps),
                    durationSeconds: 300,
                    periods: 60,
                  }
                : null,
            )
          }
          hint="Expensive to be first, ordinary to arrive later. The program steps the fee down over a fixed number of periods."
        />

        {inputs.feeDecay && (
          <div className="sub-fields">
            <Field label="Shape">
              <Seg
                options={['linear', 'exponential'] as const}
                value={inputs.feeDecay.mode}
                onChange={(mode) => set('feeDecay', { ...inputs.feeDecay!, mode })}
              />
            </Field>
            <Slider
              label="Settles at"
              value={inputs.feeDecay.endingFeeBps}
              min={25}
              max={Math.max(25, inputs.startingFeeBps)}
              step={25}
              format={(v) => `${(v / 100).toFixed(2)}%`}
              onChange={(v) => set('feeDecay', { ...inputs.feeDecay!, endingFeeBps: v })}
              {...(inputs.feeDecay.endingFeeBps >= inputs.startingFeeBps
                ? {
                    hint: 'Settling where it starts is a flat fee, so no schedule is sent. Lower this to make the fee decay.',
                  }
                : {})}
            />
            <Slider
              label="Over"
              value={inputs.feeDecay.durationSeconds}
              min={60}
              max={3600}
              step={60}
              format={(v) => `${Math.round(v / 60)} min`}
              onChange={(v) => set('feeDecay', { ...inputs.feeDecay!, durationSeconds: v })}
              hint={`In ${inputs.feeDecay.periods} steps.`}
            />
          </div>
        )}

        <Toggle
          label="Dynamic fee"
          checked={inputs.dynamicFee}
          onChange={(on) => set('dynamicFee', on)}
          hint="An extra fee that rises with volatility and decays back, driven by the program's own volatility tracker."
        />
      </Group>

      <Group title="Fee routing" caption="Who the fee is paid in, and to whom." collapsed>
        <Field
          label="Fee taken in"
          hint="Quote takes it on the way in. Output takes it out of the token being bought, which credits the base-token fee buckets instead."
        >
          <Seg
            options={['quote', 'output'] as const}
            labels={['Quote', 'Output token']}
            value={inputs.collectFeeIn}
            onChange={(value) => set('collectFeeIn', value)}
          />
        </Field>
        <Slider
          label="Creator's share"
          value={inputs.creatorFeeShare}
          min={0}
          max={100}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => set('creatorFeeShare', v)}
          hint="The rest goes to the launch partner. The protocol's 20% is taken before either."
        />
        <Field
          label="Seed"
          hint="The same seed always gives the same launch, so a difference between two curves is the curve and not the dice."
        >
          <input type="text" value={inputs.seed} onChange={(e) => set('seed', e.target.value)} />
        </Field>
      </Group>
    </aside>
  )
}

/* --------------------------------------------------------------- scenarios */

function Scenarios({
  inputs,
  setInputs,
}: {
  inputs: LaunchInputs
  setInputs: (update: (current: LaunchInputs) => LaunchInputs) => void
}) {
  const [open, setOpen] = useState(false)
  const scenario = scenarioFor(inputs.scenario)
  const crowd = crowdOf(inputs)
  const edited = inputs.crowd !== null

  return (
    <section className="panel scenarios">
      <header>
        <h2>Who turns up</h2>
        <span className="note">the same curve, a different crowd</span>
      </header>

      <div className="seg seg-wide">
        {SCENARIOS.map((option) => (
          <button
            key={option.key}
            aria-pressed={inputs.scenario === option.key && !edited}
            onClick={() =>
              setInputs((current) => ({ ...current, scenario: option.key, crowd: null }))
            }
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className="asks">{scenario.asks}</p>
      <p className="behaviour">{scenario.behaviour}</p>

      <button className="disclose" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Hide' : 'Show'} the crowd this runs{' '}
        <span className="mono">
          {crowd.snipers} sniper{crowd.snipers === 1 ? '' : 's'} · {crowd.whales} whale
          {crowd.whales === 1 ? '' : 's'} · {crowd.organics} organic
        </span>
        {edited && <span className="tag">edited</span>}
      </button>

      {open && (
        <div className="sub-fields">
          {(['snipers', 'whales', 'organics'] as const).map((kind) => (
            <Slider
              key={kind}
              label={kind[0]!.toUpperCase() + kind.slice(1)}
              value={crowd[kind]}
              min={0}
              max={kind === 'organics' ? 30 : 8}
              format={(v) => String(v)}
              onChange={(v) =>
                setInputs((current) => ({ ...current, crowd: { ...crowd, [kind]: v } }))
              }
            />
          ))}
          <p className="hint">
            Organic buyers sell a slice {Math.round(scenario.sellChance * 100)}% of the time and act
            in {Math.round(scenario.activity * 100)}% of rounds, which is the scenario&rsquo;s doing
            rather than the crowd&rsquo;s.
          </p>
        </div>
      )}
    </section>
  )
}

/* ----------------------------------------------------------------- results */

function Results({
  run,
  baseline,
  changes,
  onPin,
  onReset,
}: {
  run: SimulationOutput
  baseline: { inputs: LaunchInputs; run: SimulationOutput } | null
  changes: readonly Change[]
  onPin: () => void
  onReset: () => void
}) {
  const { report, derived, findings, quoteAsset, shape, facts, tape } = run
  const before = changes.length > 0 ? baseline?.run : undefined
  const q = quoteAsset.symbol
  const dp = quoteAsset.decimals
  const held = report.concentration
  const errors = findings.filter((finding) => finding.severity === 'error')

  return (
    <>
      <div className={`verdict${report.graduated ? '' : ' no'}`}>
        <div className="mark">{report.graduated ? '✓' : '—'}</div>
        <div>
          <div className="headline">
            {report.graduated
              ? `Graduated in ${duration(report.timeToGraduationSeconds ?? 0n)}`
              : 'Never reached graduation'}
          </div>
          <div className="sub">
            {report.graduated
              ? `${report.trades} trades raised ${short(report.quoteRaised, dp)} ${q}. Liquidity moves to a DAMM pool.`
              : `${report.trades} trades raised ${short(report.quoteRaised, dp)} of ${derived.migrationQuoteThreshold.toLocaleString()} ${q}.`}
          </div>
        </div>
        {before && (
          <div className="verdict-then">
            <span>baseline</span>
            {before.report.graduated
              ? duration(before.report.timeToGraduationSeconds ?? 0n)
              : 'no graduation'}
          </div>
        )}
      </div>

      {changes.length > 0 && (
        <section className="panel compare">
          <header>
            <h2>Changed from the baseline</h2>
            <span className="note">
              <button className="linky" onClick={onReset}>
                revert
              </button>
              {' · '}
              <button className="linky" onClick={onPin}>
                make this the baseline
              </button>
            </span>
          </header>
          <ul className="changes">
            {changes.map((change) => (
              <li key={change.label}>
                <span className="what">{change.label}</span>
                <span className="mono from">{change.from}</span>
                <span className="arrow">→</span>
                <span className="mono to">{change.to}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Why facts={facts} run={run} />

      <section className="panel">
        <header>
          <h2>How it played out</h2>
          <span className="note">seed &ldquo;{report.seed}&rdquo;</span>
        </header>
        <PriceChart
          candles={report.candles}
          quoteSymbol={q}
          migrationPrice={derived.migrationPrice}
        />
      </section>

      <section className="panel">
        <header>
          <h2>Who took which part of the curve</h2>
          <span className="note">before fees, before traders</span>
        </header>
        <CurveChart shape={shape} quoteSymbol={q} quoteDecimals={dp} />
        <OwnershipRibbon rows={tape} migrationThreshold={migrationThresholdAtomic(derived, dp)} />
      </section>

      <section className="panel tape-panel">
        <header>
          <h2>Trade tape</h2>
          <span className="note">{tape.length} trades, in the order they executed</span>
        </header>
        <TradeTape rows={tape} quoteSymbol={q} quoteDecimals={dp} />
      </section>

      <section className="panel">
        <header>
          <h2>Take it on chain</h2>
          <a className="note linky" href="/inspect">
            verify the engine first
          </a>
        </header>
        <ExportConfig args={run.configArgs} />
      </section>

      {findings.length > 0 && (
        <section className="panel">
          <header>
            <h2>Before you launch this</h2>
            <span className="note">
              {errors.length > 0 ? `${errors.length} blocking` : 'nothing blocking'}
            </span>
          </header>
          <ul className="findings">
            {findings.map((finding) => (
              <li key={finding.code}>
                <span
                  className="pip"
                  style={{
                    background: finding.severity === 'error' ? 'var(--bad)' : 'var(--warn)',
                  }}
                />
                <span>
                  <b>{finding.severity === 'error' ? 'Rejected. ' : 'Worth knowing. '}</b>
                  {finding.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

/**
 * The right-hand readout: what the launch came to.
 *
 * Separated from the centre column because these are conclusions, not working.
 * The centre is where a launch is designed and watched; this is what it was
 * worth when it stopped.
 */
function Readout({ run, before }: { run: SimulationOutput; before: SimulationOutput | undefined }) {
  const { report, derived, quoteAsset, facts, groups } = run
  const q = quoteAsset.symbol
  const dp = quoteAsset.decimals
  const held = report.concentration
  const feeTotalQuote = facts.fees.quote

  return (
    <aside className="rail readout">
      <section className="panel">
        <header>
          <h2>Outcome</h2>
        </header>
        <div className="hero-figure">
          <div className="v">
            {fmtPrice(derived.migrationMarketCap)} <span className="u">{q}</span>
          </div>
          <div className="l">Fully diluted value at graduation</div>
          {before && (
            <div className="delta-inline">
              {delta(derived.migrationMarketCap, before.derived.migrationMarketCap)?.text ?? ''}
            </div>
          )}
        </div>
        <dl>
          <Metric k="At launch" v={`${fmtPrice(derived.initialMarketCap)} ${q}`} />
          <Metric
            k="Price move"
            v={`${derived.priceMultiple.toFixed(1)}×`}
            s="opening to graduation"
            d={delta(derived.priceMultiple, before?.derived.priceMultiple)}
          />
          <Metric
            k="Raised"
            v={`${short(report.quoteRaised, dp)} ${q}`}
            s={`${report.buys} buys · ${report.sells} sells`}
            d={delta(num(report.quoteRaised, dp), before && num(before.report.quoteRaised, dp))}
          />
          <Metric
            k="In the first minute"
            v={`${(facts.raisedInFirstMinute * 100).toFixed(0)}%`}
            s="of the total raise"
            d={delta(facts.raisedInFirstMinute, before?.facts.raisedInFirstMinute, 'pct')}
          />
        </dl>
      </section>

      <section className="panel">
        <header>
          <h2>Who ends up holding it</h2>
        </header>
        <GroupBar groups={groups} />
        <dl>
          {groups.map((group) => (
            <div className="metric group-row" key={group.archetype}>
              <dt>
                <span
                  className="swatch"
                  style={{ background: ARCHETYPE_COLOUR[group.archetype] }}
                />
                {group.archetype}
                <span className="s">{group.holders} still holding</span>
              </dt>
              <dd>
                <span className="v">{(group.share * 100).toFixed(1)}%</span>
                <span
                  className={`delta ${group.realisedPnlQuote > 0n ? 'good' : group.realisedPnlQuote < 0n ? 'bad' : 'flat'}`}
                >
                  {signed(group.realisedPnlQuote, dp)} {q}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="caption">
          Share of the supply still held, and the profit taken on what was sold.
        </p>
        <dl>
          <Metric
            k="Largest holder"
            v={`${(held.topHolderShare * 100).toFixed(0)}%`}
            tone={held.topHolderShare > 0.5 ? 'warn' : null}
            d={delta(held.topHolderShare, before?.report.concentration.topHolderShare, 'pct')}
            signal="down"
          />
          <Metric
            k="Top five"
            v={`${(held.topFiveShare * 100).toFixed(0)}%`}
            d={delta(held.topFiveShare, before?.report.concentration.topFiveShare, 'pct')}
            signal="down"
          />
          <Metric
            k="Snipers at their peak"
            v={facts.snipers ? `${(facts.snipers.peakSupplyShare * 100).toFixed(1)}%` : 'none ran'}
            s={facts.snipers ? 'of total supply, while they held it' : undefined}
            tone={facts.snipers && facts.snipers.peakSupplyShare > 0.1 ? 'bad' : null}
            d={delta(
              facts.snipers?.peakSupplyShare ?? 0,
              before?.facts.snipers?.peakSupplyShare ?? (before ? 0 : undefined),
              'pct',
            )}
            signal="down"
          />
          <Metric
            k="Holders"
            v={`${held.holders}`}
            s={`Gini ${held.gini.toFixed(2)}`}
            d={delta(held.holders, before?.report.concentration.holders)}
            signal="up"
          />
        </dl>
      </section>

      <section className="panel">
        <header>
          <h2>What trading cost</h2>
        </header>
        <div className="hero-figure small">
          <div className="v">
            {short(feeTotalQuote, dp)} <span className="u">{q}</span>
          </div>
          <div className="l">taken in fees</div>
        </div>
        <FeeSplit fees={facts.fees} decimals={dp} symbol={q} />
        {facts.fees.base > 0n && (
          <p className="caption">
            Fees are collected in the output token, so buys were charged in the token itself:{' '}
            {short(facts.fees.base, 6)} tokens on top of the {q} above.
          </p>
        )}
        <dl>
          <Metric
            k="Average slippage"
            v={`${(report.averageSlippage * 100).toFixed(1)}%`}
            s={`worst ${(report.worstSlippage * 100).toFixed(0)}%`}
            tone={report.worstSlippage > 0.4 ? 'warn' : null}
            d={delta(report.averageSlippage, before?.report.averageSlippage, 'pct')}
            signal="down"
          />
          <Metric
            k="Volatility"
            v={report.volatility.toFixed(3)}
            s="deviation of log returns per trade"
            d={delta(report.volatility, before?.report.volatility)}
            signal="down"
          />
          <Metric
            k="Closed below its peak"
            v={`${(facts.drawdownFromPeak * 100).toFixed(1)}%`}
            d={delta(facts.drawdownFromPeak, before?.facts.drawdownFromPeak, 'pct')}
            signal="down"
          />
        </dl>
      </section>
    </aside>
  )
}

/** The split of held supply, as one bar. */
function GroupBar({ groups }: { groups: SimulationOutput['groups'] }) {
  const shown = groups.filter((group) => group.share > 0)
  if (shown.length === 0) return <div className="empty">Nobody is holding the token.</div>

  return (
    <div className="split-bar">
      {shown.map((group) => (
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
  )
}

/** Where the fee went. The protocol takes its cut before the other two split. */
function FeeSplit({
  fees,
  decimals,
  symbol,
}: {
  fees: SimulationOutput['facts']['fees']
  decimals: number
  symbol: string
}) {
  const total = fees.quote
  if (total === 0n) return null

  const parts = [
    { label: 'Protocol', amount: fees.protocol.quote, colour: 'var(--c1)' },
    { label: 'Partner', amount: fees.partner.quote, colour: 'var(--c3)' },
    { label: 'Creator', amount: fees.creator.quote, colour: 'var(--c2)' },
  ]

  return (
    <>
      <div className="split-bar">
        {parts.map((part) => (
          <span
            key={part.label}
            title={`${part.label}: ${short(part.amount, decimals)} ${symbol}`}
            style={{
              width: `${(Number(part.amount) / Number(total)) * 100}%`,
              background: part.colour,
            }}
          />
        ))}
      </div>
      <dl>
        {parts.map((part) => (
          <div className="metric group-row" key={part.label}>
            <dt>
              <span className="swatch" style={{ background: part.colour }} />
              {part.label}
            </dt>
            <dd>
              <span className="v">{short(part.amount, decimals)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </>
  )
}

/**
 * The migration threshold in atomic units.
 *
 * `LaunchMetrics` reports it in whole tokens for display; the ribbon needs it
 * in the same units the pool's reserve is kept in.
 */
function migrationThresholdAtomic(derived: SimulationOutput['derived'], decimals: number): bigint {
  return BigInt(Math.round(derived.migrationQuoteThreshold * 10 ** decimals))
}

/** A signed amount, so a loss reads as one. */
function signed(atomic: bigint, decimals: number): string {
  const value = Number(atomic) / 10 ** decimals
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

/**
 * Why the outcome looks the way it does.
 *
 * Every sentence is generated from a fact the trace recorded, and each carries
 * the parameter that governs it, so a number on screen can be traced both back
 * to the step that produced it and forward to the lever that changes it.
 */
function Why({ facts, run }: { facts: LaunchFactsOf; run: SimulationOutput }) {
  const q = run.quoteAsset.symbol
  const dp = run.quoteAsset.decimals
  const lines: { text: string; lever: string }[] = []

  if (facts.firstBuy) {
    lines.push({
      text: `The first trade was a ${facts.firstBuy.archetype}, taking ${(facts.firstBuy.supplyShare * 100).toFixed(2)}% of the supply before anyone else moved.`,
      lever: `Opening fee ${run.derived.startingFeePercent.toFixed(2)}%`,
    })
  }

  if (facts.snipers) {
    const { peakSupplyShare, exitedAtSeconds, realisedPnlQuote, endingSupplyShare } = facts.snipers
    const pnl = Number(realisedPnlQuote) / 10 ** dp
    lines.push({
      text:
        `Snipers held ${(peakSupplyShare * 100).toFixed(2)}% of the supply at their peak. ` +
        (exitedAtSeconds === null
          ? `None of them sold; they still hold ${(endingSupplyShare * 100).toFixed(2)}%.`
          : `They were out by ${exitedAtSeconds}s, ${pnl >= 0 ? 'taking' : 'losing'} ${Math.abs(pnl).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${q}${pnl < 0 ? ' — being first cost more than it paid' : ''}.`),
      lever: 'Opening fee, fee decay',
    })
  }

  if (facts.quoteSoldBack > 0n) {
    lines.push({
      text: `Sellers took ${short(facts.quoteSoldBack, dp)} ${q} back out of the curve across ${run.report.sells} sells, against ${run.report.buys} buys.`,
      lever: 'Who turns up',
    })
  }

  if (facts.largestBuySupplyShare > 0) {
    lines.push({
      text: `The largest single buy took ${(facts.largestBuySupplyShare * 100).toFixed(2)}% of the supply in one trade, at ${(run.report.worstSlippage * 100).toFixed(0)}% worst-case slippage.`,
      lever: 'Held back for the pool',
    })
  }

  if (!run.report.graduated) {
    lines.push({ text: stopReason(facts.endReason), lever: 'Graduates at' })
  }

  if (lines.length === 0) return null

  return (
    <section className="panel why">
      <header>
        <h2>Why it went that way</h2>
        <span className="note">read off the trace, not inferred</span>
      </header>
      <ul>
        {lines.map((line) => (
          <li key={line.text}>
            <span>{line.text}</span>
            <span className="lever">{line.lever}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

type LaunchFactsOf = SimulationOutput['facts']

/* -------------------------------------------------------------- primitives */

function Group({
  title,
  caption,
  collapsed = false,
  children,
}: {
  title: string
  caption: string
  collapsed?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(!collapsed)
  return (
    <section className="panel group">
      <header>
        <button className="group-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <h2>{title}</h2>
          <span className="chev">{open ? '–' : '+'}</span>
        </button>
      </header>
      {open && (
        <>
          <p className="caption">{caption}</p>
          {children}
        </>
      )}
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="field">
      <div className="label">
        <span>{label}</span>
      </div>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

function Seg<T extends string | number>({
  options,
  labels,
  value,
  onChange,
}: {
  options: readonly T[]
  labels?: readonly string[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="seg">
      {options.map((option, index) => (
        <button
          key={String(option)}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {labels?.[index] ?? String(option)}
        </button>
      ))}
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: string
}) {
  return (
    <div className="field">
      <label className="toggle">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format: (value: number) => string
  onChange: (value: number) => void
  hint?: string
}) {
  return (
    <div className="field">
      <div className="label">
        <span>{label}</span>
        <span className="val">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

function Metric({
  k,
  v,
  s,
  d,
  tone,
  signal,
}: {
  k: string
  v: string
  s?: string | undefined
  d?: Delta | null
  tone?: 'warn' | 'bad' | null
  /**
   * Which way is better, for the few metrics where there is an answer. A
   * change in trade count or fee revenue is neither good nor bad, and
   * colouring it green would be a number pretending to be a judgement.
   */
  signal?: 'up' | 'down'
}) {
  const direction = d && signal ? (signal === 'down' ? -d.sign : d.sign) : 0
  return (
    <div className="metric">
      <dt>
        {k}
        {s && <span className="s">{s}</span>}
      </dt>
      <dd>
        <span className={`v${tone ? ` ${tone}` : ''}`}>{v}</span>
        {d && (
          <span className={`delta ${direction > 0 ? 'good' : direction < 0 ? 'bad' : 'flat'}`}>
            {d.text}
          </span>
        )}
      </dd>
    </div>
  )
}

/* ----------------------------------------------------------------- helpers */

interface Delta {
  readonly text: string
  /** +1 when the number rose, -1 when it fell, 0 when it did not move. */
  readonly sign: number
}

/**
 * The change from the baseline, or nothing when there is no baseline to
 * compare against. Percentages are shown in points because a slippage moving
 * from 2% to 4% is "+2 points", not "+100%".
 */
function delta(
  current: number,
  before: number | undefined,
  kind: 'abs' | 'pct' = 'abs',
): Delta | null {
  if (before === undefined) return null
  const difference = current - before
  if (Math.abs(difference) < 1e-9) return { text: 'no change', sign: 0 }
  const sign = difference > 0 ? 1 : -1
  if (kind === 'pct') {
    const points = Math.abs(difference * 100)
    if (points < 0.05) return { text: 'no change', sign: 0 }
    return { text: `${sign > 0 ? '+' : '−'}${points.toFixed(1)} pts`, sign }
  }
  if (before === 0) return { text: sign > 0 ? 'from nothing' : 'to nothing', sign }
  const relative = Math.abs(difference / before) * 100
  // A change too small to show is not a change worth reporting; "−0%" beside
  // an unchanged figure reads as a bug, because it looks like one.
  if (relative < 0.5) return { text: 'no change', sign: 0 }
  return { text: `${sign > 0 ? '+' : '−'}${relative.toFixed(0)}%`, sign }
}

/**
 * Which phase the reader is in, judged by what they have changed. Changing only
 * the crowd is stress testing; changing the curve itself is a comparison.
 */
function phaseOf(changes: readonly Change[]): 'Configure' | 'Stress test' | 'Compare' {
  if (changes.length === 0) return 'Configure'
  const crowdOnly = changes.every(
    (change) => change.label === 'Scenario' || change.label === 'Crowd' || change.label === 'Seed',
  )
  return crowdOnly ? 'Stress test' : 'Compare'
}

interface Change {
  readonly label: string
  readonly from: string
  readonly to: string
}

/** What a reader changed since pinning the baseline, in their own terms. */
function describeChanges(before: LaunchInputs, now: LaunchInputs): Change[] {
  const changes: Change[] = []
  const add = (label: string, from: unknown, to: unknown) => {
    if (String(from) !== String(to)) changes.push({ label, from: String(from), to: String(to) })
  }

  add('Priced in', before.quote, now.quote)
  add(
    'Total supply',
    before.totalTokenSupply.toLocaleString(),
    now.totalTokenSupply.toLocaleString(),
  )
  add(
    'Graduates at',
    `${before.migrationQuoteThreshold.toLocaleString()} ${before.quote}`,
    `${now.migrationQuoteThreshold.toLocaleString()} ${now.quote}`,
  )
  add(
    'Held back for the pool',
    `${before.percentageSupplyOnMigration}%`,
    `${now.percentageSupplyOnMigration}%`,
  )
  add(
    'Opening fee',
    `${(before.startingFeeBps / 100).toFixed(2)}%`,
    `${(now.startingFeeBps / 100).toFixed(2)}%`,
  )
  add('Fee decay', feeDecayLabel(before), feeDecayLabel(now))
  add('Dynamic fee', before.dynamicFee ? 'on' : 'off', now.dynamicFee ? 'on' : 'off')
  add('Fee taken in', before.collectFeeIn, now.collectFeeIn)
  add("Creator's share", `${before.creatorFeeShare}%`, `${now.creatorFeeShare}%`)
  add('Scenario', scenarioFor(before.scenario).label, scenarioFor(now.scenario).label)
  // A different scenario brings its own crowd, so only report the crowd when it
  // was edited by hand into something the scenario would not have produced.
  if (before.crowd !== null || now.crowd !== null) {
    add('Crowd', crowdLabel(before), crowdLabel(now))
  }
  add('Seed', before.seed, now.seed)

  return changes
}

const feeDecayLabel = (inputs: LaunchInputs): string =>
  inputs.feeDecay
    ? `${(inputs.feeDecay.endingFeeBps / 100).toFixed(2)}% over ${Math.round(inputs.feeDecay.durationSeconds / 60)}m, ${inputs.feeDecay.mode}`
    : 'flat'

const crowdLabel = (inputs: LaunchInputs): string => {
  const crowd = crowdOf(inputs)
  return `${crowd.snipers}/${crowd.whales}/${crowd.organics}`
}

/** What the scheduler said, rather than a guess at what it meant. */
function stopReason(reason: LaunchFactsOf['endReason']): string {
  if (reason === 'curve-complete') return 'The curve completed.'
  if (reason === 'no-more-trades')
    return 'Everybody stopped trading: no participant had quote left, or none of them wanted to act again.'
  return 'The raise stalled: 600 trades went by without reaching the threshold, which is where the simulation stops.'
}

const num = (atomic: bigint, decimals: number): number => Number(atomic) / 10 ** decimals

function fmtPrice(value: number): string {
  if (value === 0) return '0'
  if (value < 1e-6) return value.toExponential(1)
  if (value < 1) return value.toPrecision(3)
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function short(atomic: bigint, decimals: number): string {
  const whole = Number(atomic) / 10 ** decimals
  if (whole >= 1000) return whole.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return whole.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function duration(seconds: bigint): string {
  const total = Number(seconds)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m ${total % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
