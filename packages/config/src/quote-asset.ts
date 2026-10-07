import { TokenDecimal } from '@meteora-ag/dynamic-bonding-curve-sdk'

/**
 * A description of what a launch is priced in.
 *
 * The engine deliberately knows none of this. It works in raw atomic units, so
 * a curve quoted in SOL and one quoted in a tokenized share of Apple are the
 * same arithmetic. Everything that makes them *feel* different — how many
 * decimals, what to call it, what it is worth in dollars — lives here, at the
 * edge, where it can be changed without touching a line of engine code.
 */
export interface QuoteAsset {
  readonly mint: string
  readonly symbol: string
  readonly decimals: TokenDecimal
  /** Which token program owns the mint. This decides eligibility, below. */
  readonly program: TokenProgram
  /**
   * Token-2022 extensions present on the mint. Only relevant for Token-2022;
   * an empty list on a Token-2022 mint means a plain one.
   */
  readonly extensions?: readonly string[]
  /** Transfer fee in basis points. A non-zero fee disqualifies a quote mint. */
  readonly transferFeeBasisPoints?: number
  /**
   * What one whole unit is worth in fiat, when that is known. Used only for
   * presentation and metrics — never by the engine, and never by validation.
   */
  readonly fiatReference?: number
}

export const TokenProgram = {
  SplToken: 'spl-token',
  Token2022: 'token-2022',
} as const
export type TokenProgram = (typeof TokenProgram)[keyof typeof TokenProgram]

/**
 * Extensions the program tolerates on a Token-2022 quote mint without a badge.
 * Taken from `is_supported_quote_mint`: anything else fails the check.
 */
const TOLERATED_EXTENSIONS: ReadonlySet<string> = new Set(['MetadataPointer', 'TokenMetadata'])

/**
 * Native SOL under Token-2022, which the program rejects outright as a quote
 * asset. Verified on mainnet as owned by the Token-2022 program.
 */
const TOKEN_2022_NATIVE_MINT = '9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP'

export interface QuoteEligibility {
  /** Whether the mint can be used as a quote asset at all. */
  readonly eligible: boolean
  /**
   * Whether it needs a `TokenBadge`. Badges are created by Meteora, not by the
   * launcher, so this is a "go and ask" rather than something to fix locally.
   */
  readonly requiresTokenBadge: boolean
  readonly reason: string
}

/**
 * Whether the program will accept this mint as a quote asset.
 *
 * Ported from `is_supported_quote_mint` and `validate_quote_mint_with_token_badge`.
 * This is the rule that decides whether a tokenized equity can actually be used
 * to price a launch, and it is not obvious from the outside: a plain SPL token
 * is always fine, while a Token-2022 mint carrying the sort of extensions a
 * regulated asset tends to carry needs Meteora to badge it first.
 */
export function quoteMintEligibility(asset: QuoteAsset): QuoteEligibility {
  if (asset.program === TokenProgram.SplToken) {
    return {
      eligible: true,
      requiresTokenBadge: false,
      reason: 'Any mint owned by the SPL Token program is accepted as quote without conditions.',
    }
  }

  if (asset.mint === TOKEN_2022_NATIVE_MINT) {
    return {
      eligible: false,
      requiresTokenBadge: false,
      reason: 'Native SOL under Token-2022 is rejected by the program and cannot be a quote asset.',
    }
  }

  const transferFee = asset.transferFeeBasisPoints ?? 0
  if (transferFee !== 0) {
    return {
      eligible: true,
      requiresTokenBadge: true,
      reason:
        `This Token-2022 mint charges a ${transferFee} bps transfer fee, which the program ` +
        'only accepts with a TokenBadge. Meteora must create that badge; it is not ' +
        'something a launcher can do.',
    }
  }

  const disallowed = (asset.extensions ?? []).filter((name) => !TOLERATED_EXTENSIONS.has(name))
  if (disallowed.length > 0) {
    return {
      eligible: true,
      requiresTokenBadge: true,
      reason:
        `This Token-2022 mint carries ${disallowed.join(', ')}, beyond the metadata extensions ` +
        'the program accepts unconditionally, so it needs a TokenBadge from Meteora. This is ' +
        'the usual situation for tokenized equities.',
    }
  }

  return {
    eligible: true,
    requiresTokenBadge: false,
    reason:
      'This Token-2022 mint has no transfer fee and carries only metadata extensions, ' +
      'so the program accepts it without a badge.',
  }
}

/** One whole unit of the quote asset, in atomic units. */
export function oneWholeUnit(asset: QuoteAsset): bigint {
  return 10n ** BigInt(asset.decimals)
}

/** Wrapped SOL: the quote asset behind the overwhelming majority of DBC pools. */
export const SOL: QuoteAsset = {
  mint: 'So11111111111111111111111111111111111111112',
  symbol: 'SOL',
  decimals: TokenDecimal.NINE,
  program: TokenProgram.SplToken,
}

/** USDC: the common choice when a launch wants a stable denominator. */
export const USDC: QuoteAsset = {
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  symbol: 'USDC',
  decimals: TokenDecimal.SIX,
  program: TokenProgram.SplToken,
}
