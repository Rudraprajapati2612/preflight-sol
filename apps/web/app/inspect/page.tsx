'use client'

import { useState } from 'react'

import { Evidence } from '../../components/Evidence'
import { Nav } from '../../components/Nav'

/**
 * Point the engine at a launch that exists.
 *
 * The simulator answers what a curve would do. This answers whether to believe
 * it: load a pool that is running on mainnet right now, replay every trade it
 * has seen through the same engine, and compare against what the program
 * recorded at the time.
 */

interface Divergence {
  step: number
  field: string
  expected: string
  actual: string
}

interface Result {
  address: string
  meta: { baseMint: string; quoteMint: string; creator: string; isMigrated: boolean }
  quote: { mint: string; decimals: number; symbol: string }
  state: {
    price: number
    quoteRaised: string
    migrationThreshold: string
    progress: number
    feesToProtocol: string
    feesToPartner: string
    feesToCreator: string
    graduated: boolean
  }
  curve: { openingPrice: number; migrationPrice: number; startedWith: string }
  replay: {
    swaps: number
    fieldsCompared: number
    divergences: number
    exact: boolean
    firstDivergences: Divergence[]
    unsupported: { step: number; reason: string }[]
    capped: boolean
  }
}

/** Launches worth looking at, so nobody has to go and find an address. */
const EXAMPLES = [
  { label: 'A graduated launch', address: '26tyUtzCPREhKTFXENakpXdZTsSvoegY34svMB7sGbrL' },
  { label: '86 trades', address: 'CCKDcwbrtmNPR3ELw8DeDr6z5yiij7FbEUaRE2ncAMq2' },
  { label: 'Still on its curve', address: 'CrfpmiPrENi17vnMcxdJ5dViWzXBCRsK3hPodQNLi5DV' },
]

export default function Inspect() {
  const [address, setAddress] = useState('')
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ok'; result: Result }
  >({ status: 'idle' })

  async function load(target: string) {
    setAddress(target)
    setState({ status: 'loading' })
    try {
      const response = await fetch(`/api/pool?address=${encodeURIComponent(target)}`)
      const body = await response.json()
      if (!response.ok) {
        setState({ status: 'error', message: body.error ?? 'Could not read that pool.' })
        return
      }
      setState({ status: 'ok', result: body as Result })
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <>
      <Nav app />
      <div className="wrap app">
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
          <h1 style={{ fontSize: 28, letterSpacing: '-0.03em', marginBottom: 12 }}>
            Does the engine agree with the chain?
          </h1>
          <p style={{ color: 'var(--ink-2)', fontSize: 15, marginBottom: 26, lineHeight: 1.62 }}>
            The program records its own answer for every swap it executes. Replaying a real launch
            and diffing every recorded field turns published history into a correctness test.
            Nothing below is an assertion about the engine; each row is a comparison that either
            matched or did not.
          </p>

          <div className="stack" style={{ marginBottom: 34 }}>
            <Evidence />
          </div>

          <h2 style={{ fontSize: 19, letterSpacing: '-0.02em', marginBottom: 10 }}>
            Replay a pool of your own
          </h2>
          <p style={{ color: 'var(--ink-2)', fontSize: 14, marginBottom: 20, lineHeight: 1.62 }}>
            Reads the pool account and its transaction history from mainnet, replays every trade
            through the same engine the workstation uses, and compares against what the program
            recorded at the time.
          </p>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (address.trim()) void load(address.trim())
            }}
            style={{ display: 'flex', gap: 10, marginBottom: 14 }}
          >
            <input
              type="text"
              value={address}
              placeholder="Pool address"
              onChange={(event) => setAddress(event.target.value)}
              style={{
                flex: 1,
                padding: '11px 13px',
                background: 'var(--bg-2)',
                border: '1px solid var(--line)',
                borderRadius: 9,
                color: 'var(--ink)',
                fontFamily: 'var(--mono)',
                fontSize: 13.5,
              }}
            />
            <button
              className="btn btn-primary"
              disabled={state.status === 'loading' || !address.trim()}
            >
              {state.status === 'loading' ? 'Replaying…' : 'Replay'}
            </button>
          </form>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 30 }}>
            {EXAMPLES.map((example) => (
              <button
                key={example.address}
                className="btn btn-ghost"
                style={{ fontSize: 12.5, padding: '6px 12px' }}
                onClick={() => void load(example.address)}
              >
                {example.label}
              </button>
            ))}
          </div>

          {state.status === 'loading' && (
            <div className="panel">
              <p style={{ color: 'var(--ink-2)', fontSize: 14, margin: 0 }}>
                Reading the pool and its transaction history from mainnet. A busy launch has
                hundreds of trades, so this takes a few seconds.
              </p>
            </div>
          )}

          {state.status === 'error' && (
            <div className="panel">
              <header>
                <h2>Could not read that pool</h2>
              </header>
              <p style={{ color: 'var(--ink-2)', fontSize: 14, margin: 0 }}>{state.message}</p>
            </div>
          )}

          {state.status === 'ok' && <Report result={state.result} />}
        </div>
      </div>
    </>
  )
}

function Report({ result }: { result: Result }) {
  const { state, curve, replay, meta, quote } = result
  const clean = replay.exact && replay.divergences === 0
  // Read from the mint rather than assumed: DBC quotes launches in whatever
  // SPL token the partner chose, and calling a USDC pool's numbers SOL would
  // be wrong by three decimal places and by a ticker.
  const amount = (atomic: string) => whole(atomic, quote.decimals)

  return (
    <div className="stack">
      <div className={`verdict${clean ? '' : ' no'}`}>
        <div className="mark">{clean ? '✓' : '!'}</div>
        <div>
          <div className="headline">
            {clean
              ? `${replay.swaps} trades replayed, every field identical`
              : `${replay.divergences} field${replay.divergences === 1 ? '' : 's'} disagreed`}
          </div>
          <div className="sub">
            {clean
              ? `${replay.fieldsCompared} comparisons against what the program recorded at the time. No tolerances.`
              : 'The engine and the program produced different numbers for this launch.'}
            {replay.capped && ' Only the most recent trades were read.'}
          </div>
        </div>
      </div>

      <div className="tiles">
        <Tile
          k="Status"
          v={state.graduated ? 'Graduated' : 'On the curve'}
          s={`${(state.progress * 100).toFixed(1)}% raised`}
        />
        <Tile k="Price now" v={fmt(state.price)} s={`${quote.symbol} per token`} />
        <Tile
          k="Opened at"
          v={fmt(curve.openingPrice)}
          s={`graduates ${fmt(curve.migrationPrice)}`}
        />
        <Tile
          k="Raised"
          v={amount(state.quoteRaised)}
          s={`of ${amount(state.migrationThreshold)} ${quote.symbol}`}
        />
        <Tile k="Trades replayed" v={String(replay.swaps)} s={`${replay.fieldsCompared} fields`} />
        <Tile
          k="Fees taken"
          v={amount(
            (
              BigInt(state.feesToProtocol) +
              BigInt(state.feesToPartner) +
              BigInt(state.feesToCreator)
            ).toString(),
          )}
          s={`${quote.symbol} · protocol, partner and creator`}
        />
      </div>

      {replay.firstDivergences.length > 0 && (
        <section className="panel">
          <header>
            <h2>Where they disagreed</h2>
          </header>
          <table className="data">
            <thead>
              <tr>
                <th>Trade</th>
                <th>Field</th>
                <th style={{ textAlign: 'right' }}>Program</th>
                <th style={{ textAlign: 'right' }}>Preflight</th>
              </tr>
            </thead>
            <tbody>
              {replay.firstDivergences.map((divergence, index) => (
                <tr key={index}>
                  <td>{divergence.step}</td>
                  <td>{divergence.field}</td>
                  <td className="num">{divergence.expected}</td>
                  <td className="num">{divergence.actual}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {replay.unsupported.length > 0 && (
        <section className="panel">
          <header>
            <h2>Stopped early</h2>
          </header>
          <ul className="findings">
            {replay.unsupported.map((item) => (
              <li key={item.step}>
                <span className="pip" style={{ background: 'var(--warn)' }} />
                <span>
                  <b>Trade {item.step}. </b>
                  {item.reason}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <header>
          <h2>On chain</h2>
        </header>
        <table className="data">
          <tbody>
            <Row label="Pool" value={result.address} />
            <Row label="Base mint" value={meta.baseMint} />
            <Row label="Quote mint" value={meta.quoteMint} />
            <Row label="Creator" value={meta.creator} />
          </tbody>
        </table>
      </section>

      <section className="panel next">
        <header>
          <h2>What this proves about the simulator</h2>
        </header>
        <p className="prose">
          The engine that replayed those trades is the same one the simulator runs. Every field it
          produced for this pool matched what the program recorded, which is the reason to believe a
          curve it has never seen.
        </p>
        <div className="cta-row" style={{ marginTop: 16 }}>
          <a className="btn btn-ghost" href="/simulate">
            Design a curve with it
          </a>
        </div>
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="name" style={{ color: 'var(--ink-3)' }}>
        {label}
      </td>
      <td className="num" style={{ fontSize: 12 }}>
        <a href={`https://solscan.io/account/${value}`} style={{ color: 'var(--brand-2)' }}>
          {value}
        </a>
      </td>
    </tr>
  )
}

function Tile({ k, v, s }: { k: string; v: string; s?: string }) {
  return (
    <div className="tile">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  )
}

function fmt(value: number): string {
  if (value === 0) return '0'
  if (value < 1e-6) return value.toExponential(1)
  if (value < 1) return value.toPrecision(3)
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function whole(atomic: string, decimals: number): string {
  const value = Number(BigInt(atomic)) / 10 ** decimals
  return value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 2 : 0 })
}
