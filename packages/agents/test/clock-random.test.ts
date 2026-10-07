import { describe, expect, it } from 'vitest'

import { deriveSeed, Random, RecordedClock, SimulatedClock } from '../src/index.js'

describe('SimulatedClock', () => {
  const start = { slot: 300_000_000n, unixTimestamp: 1_767_225_600n }

  it('advances slots at 400ms each', () => {
    const clock = new SimulatedClock(start)
    clock.advance(120n)
    expect(clock.now().unixTimestamp - start.unixTimestamp).toBe(120n)
    expect(clock.now().slot - start.slot).toBe(300n)
  })

  it('never goes backwards', () => {
    const clock = new SimulatedClock(start)
    clock.advance(-50n)
    expect(clock.now()).toEqual(start)
  })
})

/**
 * The clock is an interface so that historical replay can supply real slots and
 * real block times instead of deriving them. Real Solana slots do not arrive
 * exactly every 400ms, so a replay that derived them would drift away from the
 * chain it is meant to be reproducing.
 */
describe('RecordedClock', () => {
  const readings = [
    { slot: 100n, unixTimestamp: 1_000n },
    { slot: 137n, unixTimestamp: 1_014n },
    { slot: 400n, unixTimestamp: 1_120n },
  ]

  it('replays recorded readings rather than deriving them', () => {
    const clock = new RecordedClock(readings)
    expect(clock.now()).toEqual(readings[0])
    clock.advance()
    // 37 slots in 14 seconds: not the 400ms rule, which is the point.
    expect(clock.now()).toEqual(readings[1])
    clock.advance()
    expect(clock.now()).toEqual(readings[2])
  })

  it('holds at the last reading rather than running off the end', () => {
    const clock = new RecordedClock(readings)
    for (let i = 0; i < 10; i++) clock.advance()
    expect(clock.now()).toEqual(readings.at(-1))
  })

  it('refuses to be built with nothing to replay', () => {
    expect(() => new RecordedClock([])).toThrow(/at least one reading/)
  })
})

describe('Random', () => {
  it('is reproducible from a seed', () => {
    const draw = (seed: number) => Array.from({ length: 8 }, () => new Random(seed).next())
    expect(draw(42)).toEqual(draw(42))
  })

  it('produces a different stream from a different seed', () => {
    expect(new Random(1).next()).not.toBe(new Random(2).next())
  })

  it('survives a zero seed', () => {
    // Zero is a fixed point for the algorithm and would otherwise return the
    // same value forever.
    const random = new Random(0)
    const first = random.next()
    const second = random.next()
    expect(first).not.toBe(second)
    expect(Number.isFinite(first)).toBe(true)
  })

  it('exposes where the stream stands, so a trace can prove reproducibility', () => {
    const random = new Random(7)
    const before = random.position
    random.next()
    expect(random.position).not.toBe(before)
  })

  it('stays inside the range it is asked for', () => {
    const random = new Random(9)
    for (let i = 0; i < 200; i++) {
      const value = random.between(5, 10)
      expect(value).toBeGreaterThanOrEqual(5)
      expect(value).toBeLessThan(10)

      const int = random.intBetween(3, 6)
      expect(int).toBeGreaterThanOrEqual(3)
      expect(int).toBeLessThanOrEqual(6)

      const big = random.bigintBetween(100n, 200n)
      expect(big).toBeGreaterThanOrEqual(100n)
      expect(big).toBeLessThanOrEqual(200n)
    }
  })

  it('handles a degenerate bigint range', () => {
    expect(new Random(1).bigintBetween(50n, 50n)).toBe(50n)
    expect(new Random(1).bigintBetween(80n, 20n)).toBe(80n)
  })

  it('gives every agent a different stream from one scenario seed', () => {
    const a = deriveSeed('launch', 'sniper-1')
    const b = deriveSeed('launch', 'sniper-2')
    expect(a).not.toBe(b)
    expect(deriveSeed('launch', 'sniper-1')).toBe(a)
  })
})
