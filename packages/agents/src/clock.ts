/**
 * Time, as the simulation sees it.
 *
 * DBC runs on two clocks: the fee scheduler counts either slots or wall-clock
 * seconds depending on the config, while volatility decay always counts
 * seconds. Both have to advance together and stay consistent, and neither is an
 * agent's concern — which clock a launch uses is a property of its
 * configuration, not of the people trading on it.
 *
 * So the scheduler holds the clock and agents only ever say "now".
 */

export interface ClockReading {
  readonly slot: bigint
  readonly unixTimestamp: bigint
}

export interface Clock {
  now(): ClockReading
  advance(seconds: bigint): void
}

/**
 * Solana produces a slot roughly every 400ms. Expressed as a rational because
 * bigint division truncates: `5n / 2n` is `2n`, not 2.5.
 */
const SLOTS_PER_SECOND_NUMERATOR = 5n
const SLOTS_PER_SECOND_DENOMINATOR = 2n

/** A clock for simulated launches, deriving slots from elapsed seconds. */
export class SimulatedClock implements Clock {
  private slot: bigint
  private unixTimestamp: bigint

  constructor(start: ClockReading) {
    this.slot = start.slot
    this.unixTimestamp = start.unixTimestamp
  }

  now(): ClockReading {
    return { slot: this.slot, unixTimestamp: this.unixTimestamp }
  }

  advance(seconds: bigint): void {
    if (seconds <= 0n) return
    this.slot += (seconds * SLOTS_PER_SECOND_NUMERATOR) / SLOTS_PER_SECOND_DENOMINATOR
    this.unixTimestamp += seconds
  }
}

/**
 * A clock that replays recorded readings instead of deriving them.
 *
 * Historical replay has real slots and real block times, which do not follow
 * the 400ms rule exactly. Because the scheduler only talks to the `Clock`
 * interface, replay can supply the truth without the scheduler knowing.
 */
export class RecordedClock implements Clock {
  private index = 0

  constructor(private readonly readings: readonly ClockReading[]) {
    if (readings.length === 0) throw new Error('RecordedClock needs at least one reading')
  }

  now(): ClockReading {
    return this.readings[Math.min(this.index, this.readings.length - 1)]!
  }

  /** Advances to the next recorded reading; the argument is ignored. */
  advance(): void {
    if (this.index < this.readings.length - 1) this.index += 1
  }
}
