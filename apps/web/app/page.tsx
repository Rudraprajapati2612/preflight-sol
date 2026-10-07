import { Nav } from '../components/Nav'

/**
 * The landing page.
 *
 * Written to be specific rather than persuasive: the claims here are ones the
 * repository can be checked against, because the audience is people who will
 * check. Every figure below appears in docs/VALIDATION.md, which the replay
 * generates rather than a person writing it down.
 */
export default function Landing() {
  return (
    <>
      <Nav />

      <header className="hero">
        <div className="wrap hero-grid">
          <div>
            <div className="eyebrow">
              <span className="pin">Meteora DBC</span>
              <span>Open source · built for the Crypto World&rsquo;s Fair</span>
            </div>

            <h1 className="display">
              A bonding curve cannot be edited
              <span className="dim"> once money is on it.</span>
            </h1>

            <p className="lede">
              A DBC config fixes the shape of the curve, the fee that defends it and where the
              launch graduates — before the first trade, and for every trade after. Preflight is
              where you find out what those numbers do while changing them is still free.
            </p>

            <div className="cta-row">
              <a className="btn btn-primary btn-lg" href="/simulate">
                Open the workstation
              </a>
              <a className="btn btn-ghost btn-lg" href="/inspect">
                Replay a real pool
              </a>
            </div>
            <div className="cta-note" style={{ marginTop: 16 }}>
              No wallet. Nothing to install. The engine runs in your browser.
            </div>
          </div>

          <aside className="hero-panel">
            <div className="hero-panel-head">
              <span>One configuration, three crowds</span>
              <span className="mono">seed &ldquo;preflight&rdquo;</span>
            </div>
            <ul className="crowd-demo">
              <li>
                <span className="who">Organic flow only</span>
                <span className="out">
                  graduates <b className="good">top holder 21%</b>
                </span>
              </li>
              <li>
                <span className="who">Four sniper bots</span>
                <span className="out">
                  graduates <b className="bad">bots held 71% at their peak</b>
                </span>
              </li>
              <li>
                <span className="who">Steady profit taking</span>
                <span className="out">
                  <b className="bad">stalls at 7 of 50 SOL</b>
                </span>
              </li>
            </ul>
            <div className="hero-panel-foot">
              Same curve, same fee, same seed. The only difference is who turned up — and the third
              one never reaches its threshold.
            </div>
          </aside>
        </div>
      </header>

      <section className="section" id="how">
        <div className="wrap">
          <div className="section-head">
            <div className="kicker">What it does</div>
            <h2 className="title">Design the market, then let it be attacked</h2>
          </div>

          <div className="grid-3">
            <article className="card">
              <div className="step">01 — Configure</div>
              <h3>Describe the launch</h3>
              <p>
                Curve shape, the supply held back for the graduated pool, the opening fee and
                whether it decays, where the fee is collected and who receives it. Any SPL mint can
                be the quote asset, so a memecoin in SOL and a token priced in a tokenized equity
                are the same arithmetic.
              </p>
            </article>
            <article className="card">
              <div className="step">02 — Stress test</div>
              <h3>Let the wrong people show up</h3>
              <p>
                Pick the crowd by the question it answers: can a bot take the float in the first
                seconds, what does one whale do to everybody after it, does the raise stall under
                steady profit taking. Every run is seeded, so the same inputs give the same launch.
              </p>
            </article>
            <article className="card">
              <div className="step">03 — Read the tape</div>
              <h3>See why, not just what</h3>
              <p>
                Every trade in the order it executed, who bought which stretch of the curve, what
                each group took out, and the result stated against a pinned baseline — so a change
                you make is reported as a change rather than as a new number.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="section" id="proof">
        <div className="wrap">
          <div className="section-head">
            <div className="kicker">Why trust the numbers</div>
            <h2 className="title">The engine is checked against the real program</h2>
            <p>
              A simulator is only worth as much as its agreement with the thing it simulates. So
              Preflight does not model Meteora&rsquo;s bonding curve from the documentation. It runs
              Meteora&rsquo;s deployed mainnet bytecode inside an in-process SVM, records what the
              program actually did, and replays those recordings through the engine — comparing
              every field of every swap exactly, with no tolerances.
            </p>
            <p style={{ marginTop: 14 }}>
              Meteora&rsquo;s SDK supplies the per-swap arithmetic and Preflight calls it rather
              than writing a second copy. What Preflight adds — and what these numbers are about —
              is the part that exists nowhere else: carrying state forward across a whole launch,
              through reserves, six fee buckets, the volatility tracker and graduation.
            </p>
          </div>

          <div className="proof">
            <div>
              <div className="n">94</div>
              <div className="l">real mainnet swaps replayed, trade for trade</div>
            </div>
            <div>
              <div className="n">846</div>
              <div className="l">field comparisons against what the program recorded</div>
            </div>
            <div>
              <div className="n">5</div>
              <div className="l">launches recorded from the deployed program and replayed</div>
            </div>
            <div>
              <div className="n">0</div>
              <div className="l">divergences from the deployed program</div>
            </div>
          </div>

          <p className="proof-note">
            Those four figures are the ones in{' '}
            <a href="https://github.com/Pratikkale26/preflight/blob/main/docs/VALIDATION.md">
              docs/VALIDATION.md
            </a>
            , which the replay writes rather than a person. Separately, five launches recorded from
            the deployed program are replayed on every test run, comparing twenty-one fields per
            swap — thirteen of which are Preflight&rsquo;s own state rather than the SDK&rsquo;s
            arithmetic.
          </p>

          <div className="grid-2" style={{ marginTop: 18 }}>
            <article className="card">
              <h3>Recordings, not assumptions</h3>
              <p>
                Five launches are recorded from the real program and committed: a plain curve, one
                with the volatility-driven dynamic fee, one collecting fees in the token being
                bought, one with a decaying fee schedule, and one trading for an exact output. Each
                carries the hash of the bytecode that produced it, so a program upgrade marks it
                stale rather than leaving it quietly wrong.
              </p>
            </article>
            <article className="card">
              <h3>Tested by breaking it</h3>
              <p>
                The differential suite is checked by deliberately introducing errors into the engine
                and confirming each is caught — an off-by-one lamport, a fee taken on the wrong side
                of a trade, a volatility timestamp advanced when it should not be. Two of those
                initially slipped through, and the fix was a better recording rather than a weaker
                test.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="section" id="limits">
        <div className="wrap">
          <div className="section-head narrow">
            <div className="kicker">What it is not</div>
            <h2 className="title">A stress test, not a forecast</h2>
            <p>
              Preflight does not predict who will turn up to your launch — nobody can, and a
              simulator that claimed to would be lying. You choose the crowd. The value is
              comparative: run the same crowd against two configurations and the difference is the
              curve, because it is the only thing that changed. Read a single run as a projection
              and you are reading it wrong.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap" style={{ textAlign: 'center' }}>
          <h2 className="title" style={{ maxWidth: '22ch', margin: '0 auto' }}>
            Find out before it matters
          </h2>
          <div className="cta-row" style={{ justifyContent: 'center', marginTop: 26 }}>
            <a className="btn btn-primary btn-lg" href="/simulate">
              Open the workstation
            </a>
          </div>
        </div>
      </section>

      <footer className="foot">
        <div className="wrap">
          Preflight is open source under the MIT licence and builds on Meteora&rsquo;s{' '}
          <a href="https://github.com/MeteoraAg/dynamic-bonding-curve">Dynamic Bonding Curve</a>{' '}
          program and SDK. Not affiliated with Meteora.
        </div>
      </footer>
    </>
  )
}
