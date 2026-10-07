import { PublicKey } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'

import {
  oneWholeUnit,
  type QuoteAsset,
  quoteMintEligibility,
  SOL,
  TokenProgram,
  USDC,
} from '../src/quote-asset.js'

/**
 * A mint address typed from memory is indistinguishable from a correct one
 * until a transaction fails against the wrong token. These check the shipped
 * constants are real addresses and the eligibility rule matches the program.
 */
describe('quote asset constants', () => {
  it.each([SOL, USDC])('$symbol has a well-formed mint address', (asset) => {
    expect(() => new PublicKey(asset.mint)).not.toThrow()
    expect(new PublicKey(asset.mint).toBytes()).toHaveLength(32)
  })

  it('states each asset at its real precision', () => {
    // These match what live DBC pools actually use.
    expect(SOL.decimals).toBe(9)
    expect(USDC.decimals).toBe(6)
    expect(oneWholeUnit(SOL)).toBe(1_000_000_000n)
    expect(oneWholeUnit(USDC)).toBe(1_000_000n)
  })
})

describe('quoteMintEligibility', () => {
  const token2022 = (overrides: Partial<QuoteAsset> = {}): QuoteAsset => ({
    mint: 'AAPLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    symbol: 'AAPLx',
    decimals: 6,
    program: TokenProgram.Token2022,
    ...overrides,
  })

  it('accepts any SPL token unconditionally', () => {
    const result = quoteMintEligibility(SOL)
    expect(result.eligible).toBe(true)
    expect(result.requiresTokenBadge).toBe(false)
  })

  it('accepts a plain Token-2022 mint without a badge', () => {
    const result = quoteMintEligibility(token2022({ extensions: [] }))
    expect(result.eligible).toBe(true)
    expect(result.requiresTokenBadge).toBe(false)
  })

  it('accepts a Token-2022 mint that lists no extensions at all', () => {
    // A caller describing a mint by hand may simply omit the field rather than
    // pass an empty list, and the two have to mean the same thing.
    const result = quoteMintEligibility(token2022())
    expect(result.eligible).toBe(true)
    expect(result.requiresTokenBadge).toBe(false)
  })

  it('accepts metadata extensions without a badge', () => {
    const result = quoteMintEligibility(
      token2022({ extensions: ['MetadataPointer', 'TokenMetadata'] }),
    )
    expect(result.requiresTokenBadge).toBe(false)
  })

  it('requires a badge for a transfer fee, however small', () => {
    const result = quoteMintEligibility(token2022({ transferFeeBasisPoints: 1 }))
    expect(result.eligible).toBe(true)
    expect(result.requiresTokenBadge).toBe(true)
    expect(result.reason).toContain('TokenBadge')
  })

  it('requires a badge for the extensions a regulated asset tends to carry', () => {
    const result = quoteMintEligibility(
      token2022({ extensions: ['TransferHook', 'PermanentDelegate'] }),
    )
    expect(result.requiresTokenBadge).toBe(true)
    expect(result.reason).toContain('TransferHook')
    // This is the realistic case for tokenized equities, and the reason should
    // say so rather than leaving the launcher to work it out.
    expect(result.reason).toContain('tokenized equities')
  })

  it('rejects native SOL under Token-2022 outright', () => {
    const result = quoteMintEligibility(
      token2022({ mint: '9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP' }),
    )
    expect(result.eligible).toBe(false)
    expect(result.requiresTokenBadge).toBe(false)
  })
})
