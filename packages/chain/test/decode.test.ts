import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { VirtualPool } from '@preflight/core'
import { describe, expect, it } from 'vitest'

import { configAddressOf, decodeLivePool, DBC_PROGRAM_ID } from '../src/index.js'

/**
 * Decoding a pool that is actually running on mainnet.
 *
 * The accounts were captured once and committed, so this proves the decoding
 * against real bytes without the test suite needing network access — and
 * without its result depending on whether a stranger's pool is still alive.
 */

interface Captured {
  pool: { address: string; data: string; owner: string }
  config: { address: string; data: string; owner: string }
}

const load = (name: string): Captured =>
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), `../../core/fixtures/mainnet/${name}.json`),
      'utf8',
    ),
  ) as Captured

/** A launch that has already graduated, and one still on its curve. */
const fixture = load('live-pool')
const active = load('live-pool-active')

const bytes = (captured: Captured) => ({
  pool: Buffer.from(captured.pool.data, 'base64'),
  config: Buffer.from(captured.config.data, 'base64'),
})

const poolData = bytes(fixture).pool
const configData = bytes(fixture).config

describe('a live mainnet pool', () => {
  it('was captured from the DBC program', () => {
    expect(fixture.pool.owner).toBe(DBC_PROGRAM_ID)
    expect(fixture.config.owner).toBe(DBC_PROGRAM_ID)
  })

  it('finds the config account from the pool bytes alone', () => {
    // Saves a decode just to learn which second account to ask for.
    expect(configAddressOf(poolData)).toBe(fixture.config.address)
  })

  it('decodes into a pool the engine can run', () => {
    const { state, config, meta } = decodeLivePool(poolData, configData)

    expect(state.sqrtPrice).toBeGreaterThan(0n)
    expect(state.quoteReserve).toBeGreaterThan(0n)
    expect(state.hasSwap).toBe(true)
    expect(meta.baseMint).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    // The quote mint is on the config, not the pool — the pool records only a
    // vault — so this catches reading it from the wrong account.
    expect(meta.quoteMint).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)

    // The price must sit inside the curve it was launched with, or something
    // has been decoded into the wrong field.
    expect(state.sqrtPrice).toBeGreaterThanOrEqual(config.sqrtStartPrice)
    expect(state.sqrtPrice).toBeLessThanOrEqual(config.migrationSqrtPrice)
    expect(config.migrationQuoteThreshold).toBeGreaterThan(0n)
    expect(config.curve.some((point) => point.liquidity > 0n)).toBe(true)
  })

  it('shows the program stopping exactly where the engine says it will', () => {
    const { state, config } = decodeLivePool(poolData, configData)

    // This launch graduated. Independently of any recording, a real pool on
    // mainnet came to rest at precisely the migration price, and its quote
    // reserve sits one lamport over the threshold — the same rounding the
    // recorded fixture shows. Two separate routes to the same behaviour.
    expect(state.sqrtPrice).toBe(config.migrationSqrtPrice)
    expect(state.quoteReserve).toBe(config.migrationQuoteThreshold + 1n)
  })
})

describe('a launch still on its curve', () => {
  const { pool: poolBytes, config: configBytes } = bytes(active)

  it('has not graduated yet', () => {
    const { state, config } = decodeLivePool(poolBytes, configBytes)
    expect(state.quoteReserve).toBeLessThan(config.migrationQuoteThreshold)
    expect(state.sqrtPrice).toBeLessThan(config.migrationSqrtPrice)
  })

  it('can be simulated forward from where it stands today', () => {
    const { state, config } = decodeLivePool(poolBytes, configBytes)
    const pool = new VirtualPool(config, state)

    const before = pool.state.quoteReserve
    const clock = { slot: 0n, unixTimestamp: state.activationPoint + 3_600n }
    const { result } = pool.buy(1_000_000_000n, {
      currentPoint: VirtualPool.currentPoint(config, clock),
      currentTimestamp: clock.unixTimestamp,
      partialFill: true,
    })

    // A real launch, continued: the engine picks up where the chain left off
    // rather than from a state someone invented.
    expect(result.outputAmount).toBeGreaterThan(0n)
    expect(pool.state.quoteReserve).toBeGreaterThan(before)
    expect(pool.state.sqrtPrice).toBeGreaterThan(state.sqrtPrice)
    expect(pool.state.sqrtPrice).toBeLessThanOrEqual(config.migrationSqrtPrice)
  })

  it('reports how far along the curve the launch already is', () => {
    const { state, config } = decodeLivePool(poolData, configData)
    const progress = Number((state.quoteReserve * 100n) / config.migrationQuoteThreshold)
    expect(progress).toBeGreaterThan(0)
    expect(progress).toBeLessThanOrEqual(100)
  })
})
