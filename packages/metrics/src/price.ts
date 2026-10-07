/**
 * Prices, derived exactly and converted once.
 *
 * A square-root price is a Q64.64 fixed-point number, so the price it encodes
 * is exact. Converting to a float early and then accumulating across thousands
 * of trades would let rounding compound into the answer. So everything here
 * stays in `bigint` until the last possible moment, and the conversion happens
 * where a human is going to read the number rather than where the arithmetic
 * happens.
 */

/** Scale used when a ratio has to become a decimal without losing precision. */
const SCALE = 1_000_000_000_000n // 1e12

/**
 * Price of one whole base token in whole quote tokens.
 *
 * `price = (sqrtPrice / 2^64)^2 * 10^(baseDecimals - quoteDecimals)`
 *
 * The multiplication is done before the shift so that the intermediate keeps
 * its precision; doing it the other way round truncates small prices to zero,
 * which is exactly the range a launch starts in.
 */
export function priceFromSqrtPrice(
  sqrtPrice: bigint,
  baseDecimals: number,
  quoteDecimals: number,
): number {
  if (sqrtPrice === 0n) return 0
  const decimalAdjust = BigInt(baseDecimals) - BigInt(quoteDecimals)
  let numerator = sqrtPrice * sqrtPrice * SCALE
  let denominator = 1n << 128n

  if (decimalAdjust >= 0n) numerator *= 10n ** decimalAdjust
  else denominator *= 10n ** -decimalAdjust

  return Number(numerator / denominator) / Number(SCALE)
}

/**
 * Divide two amounts into a float without losing the small end.
 *
 * `Number(a) / Number(b)` loses precision once either exceeds 2^53, which
 * reserves and liquidity routinely do.
 */
export function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0
  return Number((numerator * SCALE) / denominator) / Number(SCALE)
}
