<p align="center">
  <img src="assets/logo.png" alt="Preflight" width="440">
</p>

<p align="center">
  <strong>Simulate your Meteora Dynamic Bonding Curve configuration before real money hits the curve.</strong>
</p>

<p align="center">
  <a href="#the-correctness-claim">Correctness</a> &middot;
  <a href="#quote-asset-agnostic-by-construction">Quote-asset agnostic</a> &middot;
  <a href="#development">Development</a> &middot;
  <a href="LICENSE">MIT</a>
</p>

---

Preflight is a simulation and mechanism-design tool for [Meteora](https://meteora.ag)
Dynamic Bonding Curves (DBC). It lets a launcher configure a curve, simulate adversarial and
organic market behaviour against it, measure the outcome, validate the simulation against real
on-chain behaviour, and only then deploy.

> **Status.** The repository is public from its first commit so that the work is visible as it
> happens.
>
> **What runs today:** the engine and its oracle — Meteora's deployed program executing
> in-process — the agent simulation, the metrics, and the web workstation. Five recorded launches
> replay bit-exactly on every test run, and 94 real mainnet swaps replay with every field
> reproduced. **What does not exist yet:** any path that signs a transaction from the browser, the
> deprecated rate-limiter fee mode, and post-graduation surplus accounting.

## Why

Configuring a DBC is a mechanism-design problem. Curve shape, fee schedule, migration threshold
and vesting interact in ways that are difficult to reason about on a whiteboard, and the feedback
loop today is a real launch with real money. A misconfigured curve can hand most of the supply to
the first few snipers, graduate at a valuation nobody intended, or never graduate at all.

Preflight closes that loop before the launch instead of after it.

## What Preflight is, precisely

Meteora's SDK already contains the per-swap arithmetic — the curve traversal, the fee numerator,
the price after a trade. Preflight calls it rather than reimplementing it: a second hand-written
port would add a source of error without adding assurance.

What the SDK cannot do is carry state forward. It prices one swap against a state you hand it. It
cannot tell you who holds the token after thirty traders have been through. **That stateful
layer — reserves, six fee buckets, the volatility tracker, the fee schedule, migration — is what
Preflight is**, and it is what the validation below is about.

## The correctness claim

A simulator is only useful if it behaves like the thing it simulates. Preflight's approach is to
make that testable rather than assertable:

- **Differential testing against the real program.** The deployed DBC bytecode
  (`dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`) is executed in-process via
  [LiteSVM](https://github.com/LiteSVM/litesvm), and the engine's output is compared field by
  field against it. Twenty-one fields per swap, of which **thirteen are Preflight's own** — the
  price, both reserves, all six fee buckets and the volatility tracker.
- **Historical replay as validation.** The program emits complete swap results on-chain, so
  replaying a real launch and diffing every recorded field turns published history into a
  correctness test. Launches executed on mainnet by people with no connection to this project
  replay with every field reproduced exactly, including the running reserve Preflight tracks
  itself: **94 swaps, 846 field comparisons, no divergences** — see
  [`docs/VALIDATION.md`](docs/VALIDATION.md), which separates what is Preflight's from what is
  Meteora's rather than adding them together.
- **Live pools, read from the chain.** A running launch can be loaded from mainnet and simulated
  forward from where it stands. One of the pools captured for the tests had already graduated, and
  it came to rest at exactly its migration price with a quote reserve one lamport over the
  threshold — the same rounding the recorded fixture shows, reached independently.
- **The curve you simulate is the curve you launch.** `pnpm deploy:devnet` builds a config,
  validates it, deploys it, reads the accounts back, and checks the deployed curve against what was
  predicted. The most recent run is recorded in
  [`docs/devnet-deployment.json`](docs/devnet-deployment.json).

The source of truth is the [DBC program](https://github.com/MeteoraAg/dynamic-bonding-curve)
itself, not documentation.

All four run. `packages/core/fixtures/oracle/baseline.json` is a recording of a complete launch
made by executing the real bytecode: four buys walking the curve up, then an oversized buy that
partial-fills, halts exactly at the migration price and hands back the remainder. That last trade
is the one a naive simulator gets wrong, and it is pinned to a number. Four more recordings cover
the dynamic fee, fees collected in the output token, exact-out swaps, and a fee decaying
exponentially on a schedule counted in slots.

## What the simulation is, and is not

Preflight does not predict who will turn up to a launch, and a tool that claimed to would be
lying. You choose the crowd. The value is comparative: run the same crowd against two
configurations and the difference is the curve, because the curve is the only thing that changed.

The participants are deliberate caricatures — a bot that buys first and largest, a buyer big
enough to move the price alone, and small frequent flow that sometimes sells — because a small set
of legible behaviours answers "how does this curve behave when the worst buyer shows up" better
than an elaborate model whose output nobody can attribute to a cause.

They do see what a real trader sees. The scheduled fee is published in the config account, so
agents are shown it, and a sniper that will not pay more than a given fee to be first is the
reason a fee schedule has any effect in the simulation at all. Before that it did not: raising the
opening fee forty-fold moved sniper capture by two points, because the bot bought at t=0 whatever
the price of admission was.

## Quote-asset agnostic by construction

`@preflight/core` operates exclusively in raw atomic units and never sees token decimals, ticker
symbols, or fiat prices. Those live in the configuration, metrics, and UI layers.

This is not an abstraction added for its own sake — it reflects how DBC actually works. Any SPL
mint can be the quote asset, and production pools today are quoted in SOL, USDC, and arbitrary
project tokens with differing decimals. Meteora's own StockLaunch pairs launches against
tokenized equities.

This is tested rather than asserted: the same curve is run against SOL at 9 decimals, USDC at 6,
and an equity profile at 6 — each with a realistic migration threshold — on the real program, and
the fee split, price movement and threshold denomination behave identically in every case.

## Running it

Requires Node >= 20 and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev
```

Then open <http://localhost:3000>. There are three screens:

- **Design + simulate** — group the configuration the way a market is designed, pick the crowd by
  the question it answers, and read the trade tape, the ownership ribbon and what the launch came
  to. The engine is plain arithmetic and runs in the browser, so the launch re-runs as you type and
  nothing round-trips to a server. The screen ends by exporting the exact `buildCurve` argument
  that produced the run.
- **Compare** — two configurations side by side. Seed, quote asset, supply and crowd are forced to
  match, so every row of the difference table is attributable to the configuration and nothing
  else.
- **Verify** — the committed mainnet replay as a standing table, and an address box for replaying
  any pool of your own.

The same seed always produces the same launch. That is what makes two curves
comparable: any difference you see is the configuration, not the dice.

Reading a live pool needs an RPC endpoint. Copy `.env.example` to `.env` and set
`HELIUS_API_KEY` or `SOLANA_RPC_URL`; the web app reads the workspace-root file.
Everything else, including the whole simulator, works offline.

### Checking it

```bash
pnpm verify      # typecheck, formatting, program-hash check, and the test suite
pnpm coverage    # which lines and branches the tests actually reach
```

`pnpm verify` is the gate: it must pass before any commit. It includes the
differential tests, which boot Meteora's deployed bytecode in an in-process SVM
and compare the engine against it field by field. No network access is needed —
the program binaries are committed for exactly that reason.

```bash
pnpm programs:dump   # refresh the committed bytecode from mainnet (needs .env)
```

Copy `.env.example` to `.env` and add an RPC endpoint to re-dump the programs,
replay a live pool, or deploy to devnet. The test suite needs none of it.

## About this project

- [Validation](docs/VALIDATION.md) — what is checked against the deployed program, and what is not
- [Architecture](docs/ARCHITECTURE.md) — how the pieces fit and why
- [Go to market](docs/GO-TO-MARKET.md) — who this is for, and an honest account of what is unproven
- [How this was built](docs/PROVENANCE.md) — tooling, process, and the mistakes it caught

## Acknowledgements

Preflight builds on Meteora's open-source work, in particular the
[Dynamic Bonding Curve program](https://github.com/MeteoraAg/dynamic-bonding-curve) and the
[TypeScript SDK](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk), whose swap math this
project wraps and verifies against.

## Licence

MIT © Pratik Kale
