# Architecture

> This document describes the intended structure and the reasoning behind it. Packages are
> introduced phase by phase. Today `@preflight/core` contains the **oracle** — the harness that runs
> Meteora's deployed program in-process. The simulation engine itself is next.

## Package layout

```
packages/
  core      simulation engine — raw atomic units only
  config    curve construction, validation, quote-asset descriptor, presets
  agents    seeded agent-based market simulation
  metrics   traces to metrics, including decimal-denominated views
  chain     on-chain ingestion, differential replay, devnet deployment
apps/
  web       the workstation
scripts/
            program dumping, devnet deploy, replay recording
```

`chain` is the only package that touches the network, and `apps/web` reaches mainnet solely
through its own route so that the RPC key stays server-side. Everything else — the engine, the
agents, the metrics, the whole simulator the browser runs — is offline arithmetic.

## The central invariant

`core` never sees decimals, symbols, or fiat prices.

Everything inside the DBC program — reserves, liquidity, thresholds, fees — is denominated in raw
atomic units. Decimals enter the system in exactly one place, when a square-root price is rendered
as a human price:

```
price = (sqrt_price^2 / 2^128) * 10^(base_decimals - quote_decimals)
```

Keeping that conversion out of the engine is what makes the engine quote-asset agnostic. A
`QuoteAsset { mint, decimals, symbol, fiatReference? }` descriptor lives in `config`, `metrics`
and `web`. Support for tokenized equities is therefore a descriptor and a preset, not a fork of
the engine — and the test that proves it is that no engine code path branches on asset identity.

## Engine strategy: wrap, then verify

Meteora's TypeScript SDK already contains a faithful port of the _per-swap_ math. What does not
exist anywhere is the **stateful layer**: applying a swap to pool state, evolving the volatility
tracker, advancing the fee scheduler, and handling migration — which is what a simulator actually
needs.

So Preflight wraps the SDK's math behind its own interface and builds the state machine itself.
Differential tests against the deployed program are the ground truth either way; if the SDK is
ever found to diverge from deployed bytecode, the interface confines the replacement to one layer.

This now exists — see [The engine](#the-engine).

Compiling the program's Rust math to WebAssembly was considered and rejected: extracting it from
Anchor's `Result` and `#[zero_copy]` machinery is disproportionate work, and it provides no
assurance that differential testing does not already provide.

## Two clocks

DBC advances on two independent clocks, and conflating them is the most common modelling error:

- The **fee scheduler** advances on `current_point`, which is a **slot** or a **unix timestamp**
  depending on the config's `activation_type`.
- The **volatility tracker** always decays on **wall-clock timestamps**.

The engine is parameterised by both. Agent simulations generate both; historical replay supplies
real slots and real block times.

## The oracle

`packages/core/src/oracle/` runs the real, deployed DBC program inside an in-process SVM
([LiteSVM](https://github.com/LiteSVM/litesvm)), driven by Meteora's own SDK. Nothing in it
reimplements DBC. It exists so that the engine has ground truth to be measured against from the
first commit, rather than a single big-bang validation at the end.

| Module              | Role                                                            |
| ------------------- | --------------------------------------------------------------- |
| `programs.ts`       | Committed bytecode and its manifest                             |
| `tx.ts`             | Bridges web3.js v1 instructions into `@solana/kit` transactions |
| `svm-connection.ts` | A `Connection` backed by the in-memory SVM                      |
| `events.ts`         | Reads Anchor events out of inner instructions                   |
| `harness.ts`        | Creates configs and pools, executes swaps, records results      |
| `scenarios.ts`      | The configurations the oracle is driven with                    |
| `fixtures.ts`       | Turns a run into a committed JSON recording                     |

Tests live in `packages/core/test/`, mirroring `src/`, rather than beside the modules they cover.
The oracle is a handful of collaborating modules, and keeping the source listing free of test files
makes it easier to read at a glance. They are still type-checked: `tsconfig.test.json` covers
`test/` without emitting, and `pnpm typecheck` runs it, because an unchecked test suite is where
type errors hide.

Four things about the real program shaped this code, none of them obvious from documentation:

1. **Two programs are required.** `initialize_virtual_pool_with_spl_token` CPIs into Metaplex
   Token Metadata, so pool creation fails unless that program is loaded too.
2. **Events are not in the logs.** The swap handler is annotated `#[event_cpi]`, so `EvtSwap` and
   `EvtSwap2` are emitted as a self-CPI and are only readable from inner instructions.
3. **Two JavaScript generations meet here.** The Meteora SDK is web3.js v1; LiteSVM 1.x speaks
   `@solana/kit`. `tx.ts` is the only module that knows both dialects.
4. **The pool address is derived, not searched.** Scanning by config would need
   `getProgramAccounts`, which an in-memory SVM has no efficient answer for. The pool is a PDA, so
   deriving it is both exact and cheaper.

The `Connection` shim implements only what the SDK actually calls and throws by name for anything
else, so a new SDK code path surfaces as a clear error rather than a plausible lie.

### Fixtures

A fixture is a recording of what the program did: the config, the pool state before and after every
swap, the fully decoded event, and the clock at each step. Keypairs are seeded, so a run is
reproducible and the fixture test can regenerate and compare on every run — which proves the oracle
is deterministic and turns any behavioural change into a reviewable diff.

Each recording carries the SHA-256 of the bytecode that produced it, so a Meteora program upgrade
marks a fixture stale rather than leaving it quietly wrong.

## The engine

`packages/core/src/engine/` is the stateful layer the SDK does not provide.

| Module          | Role                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `types.ts`      | The pool, config and swap result in `bigint`, plus the fee-mode rule |
| `decode.ts`     | Recordings back into engine types, field by field                    |
| `sdk-bridge.ts` | The only module that speaks BN                                       |
| `pool.ts`       | `VirtualPool`: applies swaps, evolves volatility, detects migration  |

### Why `bigint` rather than BN

The engine holds its state in `bigint` and converts to BN only at the SDK
boundary, the same way `tx.ts` confines the web3.js/kit divide to one module.
An agent simulation executes thousands of swaps per run, where per-operation BN
allocation costs real time, and a single numeric dialect across the engine, its
metrics and its agents is worth more than matching the SDK's types at every call
site. If the differential tests ever show the SDK's math diverging from deployed
bytecode, `sdk-bridge.ts` is the seam where a hand-written port replaces it.

### How the engine is trusted

`test/engine/differential.test.ts` replays each recording and compares three
groups of fields exactly — no tolerances, no rounding:

- the eight fields of the swap result,
- the nine pool fields: price, both reserves, and six fee buckets,
- the four volatility-tracker fields.

A simulator that is approximately right about fees and prices is not useful for
deciding how to launch a token, so "close enough" is not an acceptable result
anywhere in this suite.

### Mutation testing

A differential test that passes on its first run deserves suspicion, so the
suite is checked by deliberately breaking the engine and confirming each break
is caught: a one-lamport error in the quote reserve, taking the fee on the
output instead of the input, treating the final partial fill as exact-in,
dropping the doubling in the bin-distance calculation, skipping the decay
reduction factor, and advancing the volatility timestamp unconditionally.

The last of those initially **passed**, because every trade in the recording
crossed a price bin and the conditional branch was never taken. The fix was to
improve the recording — adding a buy small enough not to cross a bin — rather
than to soften the test. A recording that never reaches a branch cannot
validate it.

## The configuration layer

`packages/config/` is where decimals, ticker symbols and fiat prices live, precisely so the engine
never has to know about them.

| Module           | Role                                                               |
| ---------------- | ------------------------------------------------------------------ |
| `quote-asset.ts` | What a launch is priced in, and whether the program will accept it |
| `presets.ts`     | Starting points for a launch                                       |
| `validate.ts`    | Whether the program would accept a configuration, and why not      |
| `derive.ts`      | The figures a launcher actually wants to see                       |

Two of these are checked against the deployed program rather than against themselves:

- **The validator** is put to both itself and the real `create_config` in LiteSVM for one valid and
  five invalid configurations, and the two must reach the same verdict. A validator that is merely
  plausible is worse than none, because it gives a launcher confidence the chain does not share.
- **The derived figures** include `migrationSqrtPrice` and the base tokens seeded at graduation,
  neither of which appears in the configuration a launcher writes — the program computes and stores
  them. Comparing against the stored values means the numbers shown before a launch are the numbers
  the chain will use.

Findings are structured rather than thrown, and all of them are reported at once: fixing one number
at a time teaches a launcher nothing about the others. A mint that needs a `TokenBadge` is reported
as a warning rather than an error, because the configuration is sound and what is missing is a
decision by Meteora, not a number to change.

## Quote assets in practice

The claim that the engine is quote-asset agnostic is tested, not asserted. `quote-assets.test.ts`
runs the same curve against three profiles on the real program — SOL at 9 decimals, USDC at 6, and
a tokenized-equity profile at 6, each with a realistic migration threshold — and checks that the fee
split, the price movement and the threshold denomination all behave identically.

One sharp edge worth recording: **quote decimals are not recoverable from `ConfigParameters`.** They
are folded into `sqrtStartPrice` when the curve is built. A config built for 9 decimals and run
against a 6-decimal mint is wrong by a factor of 1000, and nothing in the config would reveal it.
`DbcOracle.configFor()` exists to make that mistake unrepresentable for the common path.

## Verification

- **Unit and property tests** for arithmetic and invariants.
- **Differential tests** against the deployed DBC program executed in LiteSVM.
- **Replay tests** against recorded mainnet swap events.

`pnpm verify` runs typecheck, format check, and tests, and must pass before every commit. There is
no CI; verification is local and deliberate.

## The workstation

`apps/web` is three screens over one pure function. `lib/simulate.ts` is the only place the app
builds a configuration, runs a launch and shapes the result; the pages read what it returns and
render it. That function is synchronous and has no I/O, which is what makes comparison free: the
Compare screen is two calls with one seed.

| Screen            | Route       | What it answers                                   |
| ----------------- | ----------- | ------------------------------------------------- |
| Design + simulate | `/simulate` | What does this configuration do, and why          |
| Compare           | `/compare`  | Which of these two configurations should I launch |
| Verify            | `/inspect`  | Does the engine agree with the chain              |

Three things in the results are worth naming because they are not summary statistics and cannot
be recovered from them:

- **The trade tape** — every trade in the order it executed. A sniper taking a third of the float
  at t=0 and selling it back at t=41 is one line here and is invisible in every aggregate.
- **The ownership ribbon** — which stretch of the raise each group bought through. A holder
  breakdown says who owns the token; this says where they got it, which is the fixable part.
- **Why it went that way** — sentences generated from the trace, each naming the parameter that
  governs it. Nothing in that panel is inferred; every clause is a field of a recorded step.

Comparison against a pinned baseline is preferred to comparison against the previous keystroke,
which would report noise on a dragged slider.

The categorical palette is validated rather than chosen: every pair is checked for separation
under each colour-vision deficiency against the surface it sits on. The design the workstation is
drawn from proposed an orange and an amber that fail that check, so the existing trio was kept and
the compare chart dashes its second series, because identity should not rest on hue alone.
