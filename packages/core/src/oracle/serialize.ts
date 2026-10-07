import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

/**
 * Convert SDK-decoded values into something JSON can hold without losing
 * precision. Numeric types become decimal strings rather than JavaScript
 * numbers, because u64 and u128 values from the program routinely exceed
 * `Number.MAX_SAFE_INTEGER` and silently rounding them would defeat the point
 * of a bit-exact fixture.
 */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export function toJson(value: unknown): Json {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (BN.isBN(value)) return value.toString()
  if (value instanceof PublicKey) return value.toBase58()
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex')
  if (Array.isArray(value)) return value.map(toJson)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJson(v)]),
    )
  }
  return String(value)
}
