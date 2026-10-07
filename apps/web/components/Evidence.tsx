/**
 * The committed replay, shown rather than promised.
 *
 * This was previously reachable only by pasting an address, which put the
 * credibility of the whole project behind a network call that might fail. The
 * numbers below are the ones `pnpm replay:record` wrote into docs/VALIDATION.md
 * and are as fixed as the file is; replaying a pool of your own is the thing
 * underneath, not the thing instead.
 */

/** Straight from the table in docs/VALIDATION.md. */
const REPLAYED = [
  { pool: '26tyUtzCPREhKTFXENakpXdZTsSvoegY34svMB7sGbrL', swaps: 8, fields: 72, divergences: 0 },
  { pool: 'CCKDcwbrtmNPR3ELw8DeDr6z5yiij7FbEUaRE2ncAMq2', swaps: 86, fields: 774, divergences: 0 },
] as const

const TOTAL = REPLAYED.reduce(
  (total, row) => ({
    swaps: total.swaps + row.swaps,
    fields: total.fields + row.fields,
    divergences: total.divergences + row.divergences,
  }),
  { swaps: 0, fields: 0, divergences: 0 },
)

export function Evidence() {
  return (
    <>
      <section className="panel evidence">
        <header>
          <h2>Mainnet replay — committed</h2>
          <span className={`note ${TOTAL.divergences === 0 ? 'ok' : 'bad'}`}>
            {TOTAL.divergences} divergences
          </span>
        </header>
        <table className="data">
          <thead>
            <tr>
              <th>Pool</th>
              <th className="num">Swaps</th>
              <th className="num">Fields compared</th>
              <th className="num">Divergences</th>
            </tr>
          </thead>
          <tbody>
            {REPLAYED.map((row) => (
              <tr key={row.pool}>
                <td className="num pool">
                  <a href={`https://solscan.io/account/${row.pool}`}>{row.pool}</a>
                </td>
                <td className="num">{row.swaps}</td>
                <td className="num">{row.fields}</td>
                <td className="num ok">{row.divergences}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Total</td>
              <td className="num">{TOTAL.swaps}</td>
              <td className="num">{TOTAL.fields}</td>
              <td className="num ok">{TOTAL.divergences}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <div className="grid-2">
        <section className="panel">
          <header>
            <h2>Differential against the program</h2>
          </header>
          <p className="prose">
            Five launches are recorded by running the deployed bytecode inside an in-process SVM and
            replayed on every test run: a plain curve, one with the volatility-driven dynamic fee,
            one collecting fees in the token being bought and splitting them with the creator, one
            mixing exact-in with exact-out buys, and one whose fee decays exponentially on a
            schedule counted in slots rather than seconds. Twenty-one fields are compared per swap;
            thirteen belong to Preflight — the price, both reserves, six fee buckets and the
            volatility tracker. Each recording carries the SHA-256 of the bytecode that produced it,
            so a program upgrade marks it stale rather than leaving it quietly wrong.
          </p>
        </section>

        <section className="panel">
          <header>
            <h2>What is not covered</h2>
          </header>
          <p className="prose">
            The deprecated rate-limiter fee mode is not modelled, so a pool using it cannot be
            replayed at all. Neither is what happens to surplus and leftover base after a curve
            graduates, which is out of scope for a tool about choosing a curve.
          </p>
          <p className="prose" style={{ marginTop: 12 }}>
            Where the engine cannot price a swap, the replay stops and says so rather than skipping
            it. A replay that omits what it cannot handle and then reports no divergences reads as a
            pass, which is worse than failing.
          </p>
        </section>
      </div>
    </>
  )
}
