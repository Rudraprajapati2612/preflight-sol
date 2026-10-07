import { TradeDirection } from '@preflight/core'
import type { SwapResult } from '@preflight/core'
import { describe, expect, it } from 'vitest'

import { applyTrade, openingPosition } from '../src/position.js'

/**
 * Cost basis decides when a trader takes profit, and it is the input to every
 * profit-and-loss figure a launch report will show. It is also invisible in the
 * pool: an agent can hold the right number of tokens while believing it paid
 * the wrong amount for them.
 */

const result = (overrides: Partial<SwapResult>): SwapResult => ({
  includedFeeInputAmount: 0n,
  excludedFeeInputAmount: 0n,
  amountLeft: 0n,
  outputAmount: 0n,
  nextSqrtPrice: 0n,
  tradingFee: 0n,
  protocolFee: 0n,
  referralFee: 0n,
  ...overrides,
})

describe('position accounting', () => {
  const start = openingPosition('t', 'test', 1_000n)

  it('records what was paid, not what reached the curve', () => {
    const after = applyTrade(
      start,
      TradeDirection.QuoteToBase,
      result({ includedFeeInputAmount: 100n, excludedFeeInputAmount: 99n, outputAmount: 500n }),
    )
    expect(after.quoteBalance).toBe(900n)
    expect(after.baseBalance).toBe(500n)
    // The fee was part of the cost of acquiring the position.
    expect(after.costBasisQuote).toBe(100n)
  })

  it('releases cost basis in proportion to what was sold', () => {
    const bought = applyTrade(
      start,
      TradeDirection.QuoteToBase,
      result({ includedFeeInputAmount: 100n, outputAmount: 1_000n }),
    )
    const soldHalf = applyTrade(
      bought,
      TradeDirection.BaseToQuote,
      result({ includedFeeInputAmount: 500n, outputAmount: 80n }),
    )

    expect(soldHalf.baseBalance).toBe(500n)
    // Half the position went, so half the basis goes with it.
    expect(soldHalf.costBasisQuote).toBe(50n)
    // And the profit on that half is what it fetched, less what it cost.
    expect(soldHalf.realisedPnlQuote).toBe(30n)
  })

  it('leaves nothing behind when the whole position is sold', () => {
    const bought = applyTrade(
      start,
      TradeDirection.QuoteToBase,
      result({ includedFeeInputAmount: 100n, outputAmount: 1_000n }),
    )
    const soldAll = applyTrade(
      bought,
      TradeDirection.BaseToQuote,
      result({ includedFeeInputAmount: 1_000n, outputAmount: 250n }),
    )

    expect(soldAll.baseBalance).toBe(0n)
    // A closed position has no basis left; carrying one would make the next
    // purchase look cheaper than it was.
    expect(soldAll.costBasisQuote).toBe(0n)
    expect(soldAll.realisedPnlQuote).toBe(150n)
    expect(soldAll.quoteBalance).toBe(1_150n)
  })

  it('records a loss as readily as a gain', () => {
    const bought = applyTrade(
      start,
      TradeDirection.QuoteToBase,
      result({ includedFeeInputAmount: 200n, outputAmount: 1_000n }),
    )
    const soldAll = applyTrade(
      bought,
      TradeDirection.BaseToQuote,
      result({ includedFeeInputAmount: 1_000n, outputAmount: 120n }),
    )
    expect(soldAll.realisedPnlQuote).toBe(-80n)
  })

  it('counts every trade', () => {
    const one = applyTrade(start, TradeDirection.QuoteToBase, result({ outputAmount: 1n }))
    expect(one.trades).toBe(1)
    expect(applyTrade(one, TradeDirection.BaseToQuote, result({})).trades).toBe(2)
  })
})
