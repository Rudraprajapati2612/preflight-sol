# Go to market

Written to be useful rather than flattering. Where something is unproven it
says so, because a plan that only works if every assumption holds is not a
plan.

## The problem, and who has it

Meteora's Dynamic Bonding Curve is how a large share of Solana tokens now
launch. Configuring one means choosing a curve shape, a fee schedule and a
graduation threshold — and those choices decide whether the first thirty
seconds of a launch belong to a sniper bot or to the buyers the launch was for.

Today that is guesswork. The feedback loop is a live launch with real money,
and there is no second attempt. The common workaround is copying another
project's config, which propagates whatever mistake was in it.

Two groups have this problem, and they are not the same size:

**Launch platforms** building on DBC — Believe, Jup Studio, Bags, Moonshot,
time.fun and others. They choose a curve once and then apply it to every launch
on their platform. A bad choice is not one bad launch, it is a bad platform, and
it shows up as a reputation for launches that get farmed. There are on the order
of tens of these, they are technical, and they are reachable.

**Teams launching a single token.** Far more numerous, far less reachable, and
each one needs the tool once. Useful to them, but not a business on its own.

The realistic wedge is the first group.

## What exists today that does not solve it

Meteora's SDK prices a single swap against a pool state you hand it. It is
correct and complete for that, and Preflight uses it. What it cannot do is
carry state forward — it has no answer to _"after thirty traders, who holds the
token?"_, because answering that needs reserves, fee accrual, volatility and
graduation tracked across a whole launch.

Analytics dashboards show what happened after a launch. That is the wrong side
of the decision.

Nothing available answers the question before the money is committed.

## Why Meteora would care

Badly configured launches make DBC look bad, and that is Meteora's problem
rather than the launchpad's. Every launch that gets farmed in its first minute
is a data point for the argument that bonding curves are extractive. A tool
that makes launch partners configure curves deliberately is aligned with
Meteora's interest, not merely adjacent to it — which is also why the track
brief asked for "tooling that helps issuers configure and monitor DBC pools".

## How it reaches people

**Through Meteora, not around them.** The natural distribution is Meteora's own
documentation and developer channels. A launch partner reading the DBC docs is
exactly the person with this problem, at the moment they have it.

**Open source as the entry point.** MIT, five packages usable without the
interface. A platform that wants curve simulation inside its own launch flow
should be able to take `@preflight/core` and do that, and that is a better
outcome than making them use our UI.

**The validation is the marketing.** The audience is technical and unmoved by
claims. `docs/VALIDATION.md` and the ability to replay any mainnet pool are
more persuasive than any amount of copy, because they can be checked in about
ten seconds.

## Where the money would come from — honestly, nowhere yet

There is no revenue model today, and pretending otherwise would be the weakest
thing in this document. The plausible ones, in order of how much they are
believed:

1. **Nothing.** It stays open infrastructure and the return is reputation and
   the next thing it opens. Most likely, and not a failure.
2. **Hosted service for platforms** — curve simulation embedded in a launch
   flow, monitoring of live pools, alerting on divergence. This only becomes a
   product if a platform asks for it, which has not happened.
3. **Support and configuration work** for a large launch partner. Consulting
   rather than software, and it does not scale.

The honest position: the problem is real, the tool is real, and the business is
unproven. Treating it as infrastructure first is more likely to produce a
business than assuming one now.

## What would show this is working

Signals in the order they would appear:

- Someone outside this project replays a pool they chose themselves
- A launch partner uses it before choosing a config
- `@preflight/core` is imported by someone else's code
- A curve is changed because of what the simulator showed

None of these have happened. The tool has no users, and saying otherwise would
be inventing traction.

## What has to be true for this to matter

- **DBC keeps growing.** If bonding curve launches stop being how Solana tokens
  come to market, the problem goes away. Present evidence is the opposite.
- **Curve configuration keeps mattering.** If Meteora ships a default that is
  good enough for everyone, the decision disappears. The existence of a dozen
  launch partners with different configurations suggests it does not.
- **Accuracy is worth something.** If launchers do not care whether a simulator
  is right, then a rough approximation ships faster and wins. This is the
  assumption the whole project rests on and it is the one most worth arguing
  about.

## What the simulation does not claim

Preflight does not predict turnout. The user picks the crowd, so a result is
never a forecast — it is a controlled experiment, and its value is entirely
comparative: the same crowd against two configurations isolates the curve,
because the curve is the only thing that changed. This is worth saying plainly
rather than leaving a reader to discover it, because the alternative reading —
that these are projections — is both flattering and wrong.

The mechanics underneath are not a choice. The per-swap arithmetic, the fee
schedule and the volatility tracker are the program's, verified trade for trade
against mainnet. Only turnout is assumed.

The weakest part is that the crowd is not calibrated against real launches. The
repository holds 94 replayed mainnet swaps and does not yet ask whether the
simulated organic buyer resembles a real one. Deriving size distributions and
inter-arrival times from replayed launches, and offering a calibrated preset
beside the hand-set ones, is the most valuable unbuilt thing here.

## The risk worth naming

Preflight is used **once per launch**. It is a tool, not a habit, and that
makes retention structurally weak. The answer, if there is one, is to move from
"simulate before you launch" to "watch what happens after" — the live pool
inspector is the first step in that direction, and it is the direction with a
reason for someone to come back.
