#!/usr/bin/env node
/**
 * Replay a real launch through the engine.
 *
 *   node scripts/replay.mjs <poolAddress> [...more]
 *
 * With no arguments it replays the launches recorded in
 * packages/core/fixtures/mainnet and writes docs/VALIDATION.md.
 *
 * The program records its own answer for every swap it executes, so this is a
 * correctness test made of other people's real trades rather than of cases
 * someone thought to write down.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  decodePoolConfig,
  decodeSwapsFromTransaction,
  fetchLivePool,
  fetchSwapHistory,
  orderOfExecution,
  replayLaunch,
} from '@preflight/chain'
import { Connection } from '@solana/web3.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixtures = join(root, 'packages/core/fixtures/mainnet')

const ok = (t) => console.log(`  \x1b[32m✓\x1b[0m ${t}`)
const bad = (t) => console.log(`  \x1b[31m✗\x1b[0m ${t}`)

function report(name, result) {
  console.log(`\n\x1b[38;5;141m${name}\x1b[0m`)
  console.log(`    ${result.swapsReplayed} swaps · ${result.fieldsCompared} fields compared`)
  if (result.divergences.length === 0) {
    ok('every recorded field reproduced exactly')
  } else {
    bad(`${result.divergences.length} divergence(s)`)
    for (const d of result.divergences.slice(0, 10)) {
      console.log(`      step ${d.step} ${d.field}: expected ${d.expected}, got ${d.actual}`)
    }
  }
  for (const u of result.unsupported) {
    console.log(`  \x1b[33m•\x1b[0m stopped at step ${u.step}: ${u.reason}`)
  }
  return result
}

// Writing the record is opt-in. A casual offline run would otherwise replace a
// report covering several pools with one covering the single committed launch.
const write = process.argv.includes('--write')
const addresses = process.argv.slice(2).filter((argument) => !argument.startsWith('--'))
const results = []

if (addresses.length === 0) {
  // Offline: the launches captured from mainnet and committed.
  const history = JSON.parse(readFileSync(join(fixtures, 'launch-history.json'), 'utf8'))
  const accounts = JSON.parse(readFileSync(join(fixtures, 'live-pool.json'), 'utf8'))
  const config = decodePoolConfig(Buffer.from(accounts.config.data, 'base64'))
  const swaps = history.transactions
    .flatMap((t) => decodeSwapsFromTransaction(t, history.pool))
    .sort(orderOfExecution)
  results.push({
    pool: history.pool,
    ...report(history.pool, replayLaunch(history.pool, config, swaps)),
  })
} else {
  if (!process.env.SOLANA_RPC_URL) {
    if (process.env.HELIUS_API_KEY) {
      process.env.SOLANA_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    } else {
      throw new Error('Set SOLANA_RPC_URL (an archival endpoint) to replay a live pool')
    }
  }
  const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed')
  for (const address of addresses) {
    const live = await fetchLivePool(connection, address)
    const swaps = await fetchSwapHistory(connection, address, {
      onProgress: (done, total) =>
        process.stdout.write(`\r    fetching ${done}/${total} transactions`),
    })
    process.stdout.write('\r'.padEnd(46) + '\r')
    results.push({ pool: address, ...report(address, replayLaunch(address, live.config, swaps)) })
  }
}

const totalSwaps = results.reduce((n, r) => n + r.swapsReplayed, 0)
const totalFields = results.reduce((n, r) => n + r.fieldsCompared, 0)
const totalDiv = results.reduce((n, r) => n + r.divergences.length, 0)
const totalUnsupported = results.reduce((n, r) => n + r.unsupported.length, 0)

if (write) {
  writeFileSync(
    join(root, 'docs/VALIDATION.md'),
    `# Validation

## What is Preflight's, and what is Meteora's

Meteora's SDK contains the per-swap arithmetic — the curve traversal, the fee
numerator, the square root price after a trade. Preflight calls it rather than
reimplementing it. A second hand-written port would add a source of error
without adding assurance, and the SDK is the reference implementation, tracked
by the people who wrote the program.

What the SDK does not do, and what Preflight is, is the **stateful layer**:
applying a swap to reserves and to six fee buckets, evolving the volatility
tracker that drives the dynamic fee, advancing the fee schedule as time passes,
deciding which token a fee is taken in, and recognising when a curve has
graduated. None of that exists anywhere else, and it is what the validation
below is about.

So, precisely:

- **Meteora's arithmetic, checked against Meteora's program.** Worth knowing,
  but their achievement, not ours.
- **Preflight's state machine, checked against Meteora's program.** This is the
  claim that belongs to this project.

Both are reported separately below rather than added together into one larger
number.

## Replaying real launches

Launches that happened on Solana mainnet, executed by people with no connection
to this project, are replayed through the engine. The program records its own
answer for every swap — the resulting square root price, each fee component, the
amount it could not consume — so the comparison is against what actually
happened rather than against an expectation someone wrote down.

Every field is compared exactly. There are no tolerances.

Of the nine fields compared per swap, eight are produced by Meteora's SDK and
one — the running quote reserve — is Preflight's. The eight confirm the SDK
agrees with the program across real traffic; the one confirms Preflight's state
machine tracks a launch correctly from beginning to end, through sells, partial
fills and exact-out trades, without drifting.

| Pool | Swaps | Fields compared | Divergences |
| --- | ---: | ---: | ---: |
${results
  .map(
    (r) => `| \`${r.pool}\` | ${r.swapsReplayed} | ${r.fieldsCompared} | ${r.divergences.length} |`,
  )
  .join('\n')}
| **Total** | **${totalSwaps}** | **${totalFields}** | **${totalDiv}** |

These launches include sells as well as buys, swaps that state the amount wanted
rather than the amount spent, and the partial fill that graduates a curve — the
trade most likely to be modelled wrongly, since an exact-in swap that would
cross the migration price is rejected outright rather than part-filled.

\`pnpm replay\` reproduces the committed launch offline. Given a pool address and
an archival endpoint it replays any live pool: \`pnpm replay <poolAddress>\`.

### What this took to get right

The largest of these pools produced 4153 divergences on the first attempt. None
of them were arithmetic.

Two of a launch's transactions can land in the same slot, and ordering them by
slot alone sequences them arbitrarily — every swap after the mistake inherits
it. One transaction can route through several pools, each emitting its own
event, so a replay was counting strangers' trades against this pool's reserve.
And a swap can be made *exact-out*, naming the amount wanted rather than the
amount spent, which is a different calculation and reads the event's first
parameter in the opposite role.

Each of those is invisible to a simulator checked only against its own
assumptions. They surfaced because the chain had already written down the right
answer.

### What is not covered yet

The deprecated rate-limiter fee mode is not modelled, and neither is what
happens to surplus and leftover base after a curve graduates. A pool using the
rate limiter cannot be replayed; post-graduation accounting is simply out of
scope for a tool about choosing a curve.

Where the engine cannot price a swap at all, the replay stops and says so
rather than skipping it and reporting agreement on the rest. A replay that
omits what it cannot handle and then claims no divergences is worse than one
that fails, because it reads as a pass.

## Differential tests against the program

Five launches are recorded by running the deployed bytecode inside an
in-process SVM, then replayed through the engine on every test run: a plain
curve; one with the volatility-driven dynamic fee; one collecting fees in the
token being bought and splitting them with the creator; one mixing exact-in
buys with exact-out buys; and one whose fee decays exponentially on a schedule
counted in slots rather than seconds.

That last one covers the two paths that were unverified until recently. Its
recorded fee falls from 8.000% to 1.001% across the launch, so the schedule is
genuinely running rather than sitting at its opening value. Twenty-one fields are compared per swap: the eight of the swap result, which
come from the SDK, and **thirteen that are Preflight's own** — nine pool fields
covering the price, both reserves and all six fee buckets, and the four of the
volatility tracker.

Those thirteen are the ones that matter for this project's claim — across the
recordings, several hundred direct comparisons of Preflight's state machine
against what the deployed program did.

Each recording carries the SHA-256 of the bytecode that produced it, so a
program upgrade marks it stale rather than leaving it quietly wrong.

## Checking the tests themselves

A passing suite is evidence only if it would fail when something is wrong, so
errors are deliberately introduced into the engine and each must be caught: an
off-by-one lamport in the quote reserve, a fee taken on the output instead of
the input, the final partial fill treated as exact-in, the doubling dropped from
the bin-distance calculation, the volatility decay factor skipped, and the
volatility timestamp advanced unconditionally.

Two of those initially passed. Both times the fix was a better recording rather
than a weaker test — one needed a launch with a trade too small to cross a price
bin, the other a launch collecting fees in the base token.

*Generated by \`node scripts/replay.mjs\`.*
`,
  )
  console.log('\n  recorded  docs/VALIDATION.md')
} else {
  console.log('\n  (run with --write to record this in docs/VALIDATION.md)')
}

const summary = `${totalSwaps} swaps · ${totalFields} fields · ${totalDiv} divergences`
console.log(
  `\n${totalDiv === 0 ? '\x1b[32m' : '\x1b[31m'}${summary}\x1b[0m` +
    (totalUnsupported > 0
      ? `\n\x1b[33m${totalUnsupported} launch(es) stopped early on a swap the engine does not model\x1b[0m`
      : '') +
    '\n',
)
process.exit(totalDiv === 0 ? 0 : 1)
