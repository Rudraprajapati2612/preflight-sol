import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { decodeConfig, decodePoolState } from '../../src/engine/decode.js'
import { VirtualPool } from '../../src/engine/pool.js'
import type { OracleFixture } from '../../src/oracle/fixtures.js'

/**
 * The paths that exist to stop something worse from happening.
 *
 * Defensive code that is never exercised is a guess about how a failure will
 * behave. These check the guesses.
 */

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/oracle')
const load = (name: string): OracleFixture =>
  JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), 'utf8')) as OracleFixture

const fixture = load('baseline')
const config = decodeConfig(fixture.configAccount)
const initialState = decodePoolState(fixture.initialPoolState)

// The clock only matters when the dynamic fee is on: with it off, the tracker
// is never read and a backwards clock changes nothing.
const volatileFixture = load('dynamic-fee')
const volatileConfig = decodeConfig(volatileFixture.configAccount)
const volatileInitialState = decodePoolState(volatileFixture.initialPoolState)

describe('decoding rejects malformed input', () => {
  it('refuses a config that is not an object', () => {
    expect(() => decodeConfig(null)).toThrow(/expected an object/)
    expect(() => decodeConfig([])).toThrow(/expected an object/)
    expect(() => decodeConfig('a config')).toThrow(/expected an object/)
  })

  it('names the field when a number is missing or malformed', () => {
    const broken = structuredClone(fixture.configAccount) as Record<string, unknown>
    broken['sqrtStartPrice'] = 'not a number'
    // The path matters: a bad field in a 40-key account is otherwise a hunt.
    expect(() => decodeConfig(broken)).toThrow(/sqrtStartPrice/)
  })

  it('refuses a pool state missing its volatility tracker', () => {
    const broken = structuredClone(fixture.initialPoolState) as {
      poolState: Record<string, unknown>
    }
    delete broken.poolState['volatilityTracker']
    expect(() => decodePoolState(broken)).toThrow(/volatilityTracker/)
  })

  it('accepts a bare state object as well as a wrapped account', () => {
    const wrapped = fixture.initialPoolState as { poolState: unknown }
    expect(decodePoolState(wrapped.poolState)).toEqual(decodePoolState(wrapped))
  })
})

describe('an oversized trade', () => {
  const clock = { currentPoint: 1_767_225_600n, currentTimestamp: 1_767_225_600n }

  it('is rejected outright when the caller demanded an exact fill', () => {
    const pool = new VirtualPool(config, initialState)
    // Exact-in means "consume all of this". More than the curve can absorb is
    // not a rounding problem, and the program refuses rather than part-filling.
    expect(() => pool.buy(10_000n * 1_000_000_000n, { ...clock })).toThrow(/liquidity/i)
  })

  it('is capped, not refused, when the caller allowed a partial fill', () => {
    const pool = new VirtualPool(config, initialState)
    const oversized = 10_000n * 1_000_000_000n
    const { result, stateAfter } = pool.buy(oversized, { ...clock, partialFill: true })

    // The curve stops at its migration price and hands the rest back, which is
    // what protects the reserves rather than the underflow guard in the engine.
    expect(result.amountLeft).toBeGreaterThan(0n)
    expect(result.includedFeeInputAmount).toBeLessThan(oversized)
    expect(stateAfter.baseReserve).toBeGreaterThanOrEqual(0n)
    expect(stateAfter.sqrtPrice).toBeLessThanOrEqual(config.migrationSqrtPrice)
  })

  it('leaves a sell capped at the start of the curve', () => {
    const pool = new VirtualPool(config, initialState)
    pool.buy(30n * 1_000_000_000n, { ...clock })
    const held = initialState.baseReserve - pool.state.baseReserve

    const { stateAfter } = pool.sell(held * 100n, { ...clock, partialFill: true })
    expect(stateAfter.sqrtPrice).toBeGreaterThanOrEqual(config.sqrtStartPrice)
    expect(stateAfter.baseReserve).toBeGreaterThanOrEqual(0n)
  })
})

describe('a clock that goes backwards', () => {
  it('does not produce a huge elapsed time', () => {
    const pool = new VirtualPool(volatileConfig, volatileInitialState)
    const later = 1_767_225_600n

    pool.buy(1_000_000_000n, { currentPoint: later, currentTimestamp: later })
    const afterFirst = pool.state.volatilityTracker

    // An out-of-order timestamp is possible off-chain when a clock is not
    // synced. The program uses a saturating subtraction so this reads as "no
    // time passed" rather than as an enormous gap that would wipe volatility.
    const earlier = later - 5_000n
    pool.buy(1_000_000_000n, { currentPoint: earlier, currentTimestamp: earlier })

    expect(pool.state.volatilityTracker.lastUpdateTimestamp).toBeGreaterThanOrEqual(
      afterFirst.lastUpdateTimestamp - 5_000n,
    )
    expect(pool.state.quoteReserve).toBeGreaterThan(0n)
  })
})

describe('decoding accepts what the SDK hands back', () => {
  /** Stands in for BN: decimal `toString`, hex `toJSON`. */
  class HexJsonNumber {
    constructor(private readonly value: bigint) {}
    toString(): string {
      return this.value.toString()
    }
    toJSON(): string {
      return this.value.toString(16)
    }
  }

  it('reads a number-like object, not just a string', () => {
    const account = structuredClone(fixture.configAccount) as Record<string, unknown>
    const original = decodeConfig(account).sqrtStartPrice
    account['sqrtStartPrice'] = new HexJsonNumber(original)
    expect(decodeConfig(account).sqrtStartPrice).toBe(original)
  })

  it('describes a rejected value in decimal, not in hex', () => {
    const account = structuredClone(fixture.configAccount) as Record<string, unknown>
    account['sqrtStartPrice'] = { toString: () => 'not a number' }
    // A hex rendering here would make a legitimate value look like nonsense and
    // send someone hunting for the wrong problem.
    expect(() => decodeConfig(account)).toThrow(/not a number/)
  })
})
