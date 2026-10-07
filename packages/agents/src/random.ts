/**
 * Deterministic randomness.
 *
 * A simulation whose results move between runs cannot be used to compare two
 * configurations: any difference might be the config or might be the dice. So
 * every random draw here comes from an explicit, seeded, inspectable stream,
 * and `Math.random` appears nowhere in this package.
 *
 * mulberry32 is used because its entire state is one 32-bit integer, which
 * means a trace can record exactly where the stream was at each step. That
 * turns "the run is reproducible" from a claim into something a test asserts.
 */

/** A stream of random numbers whose position can be read and restored. */
export class Random {
  private state: number

  constructor(seed: number) {
    // Zero is a fixed point for the algorithm, so shift it off.
    this.state = (seed | 0) === 0 ? 0x9e3779b9 : seed | 0
  }

  /** The current position of the stream. Recorded in traces. */
  get position(): number {
    return this.state >>> 0
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }

  /** Uniform in [min, max). */
  between(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Uniform integer in [min, max]. */
  intBetween(min: number, max: number): number {
    return Math.floor(this.between(min, max + 1))
  }

  /** Uniform bigint in [min, max], for trade sizes in atomic units. */
  bigintBetween(min: bigint, max: bigint): bigint {
    if (max <= min) return min
    const span = max - min
    // Drawn in two 32-bit halves so the whole range is reachable; a single
    // float draw would quantise a u64 range far too coarsely.
    const high = BigInt(Math.floor(this.next() * 4_294_967_296))
    const low = BigInt(Math.floor(this.next() * 4_294_967_296))
    return min + (((high << 32n) | low) % (span + 1n))
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.next() < probability
  }
}

/**
 * Derive a stream seed from a scenario seed and an agent's identity.
 *
 * Each agent must draw from its own stream. Sharing one would mean that adding
 * an agent to a scenario shifts every other agent's draws, so two runs that
 * differ by one participant would be incomparable — which is precisely the
 * comparison a launcher wants to make.
 */
export function deriveSeed(scenarioSeed: string, streamId: string): number {
  // FNV-1a, 32-bit. Chosen for being short and stable rather than for strength;
  // nothing here is security-sensitive.
  let hash = 0x811c9dc5
  for (const char of `${scenarioSeed}/${streamId}`) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
