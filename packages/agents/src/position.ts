import type { SwapResult, TradeDirection } from '@preflight/core'
import { TradeDirection as Direction } from '@preflight/core'

import type { AgentState } from './types.js'

/**
 * Apply an executed trade to an agent's holdings.
 *
 * Two details are easy to get backwards and neither is visible in a price
 * chart:
 *
 * The amount paid is the *included-fee* input, not the excluded-fee one. Under
 * a partial fill those differ from the amount requested as well, because the
 * curve consumes only what it can absorb and the rest is never spent.
 *
 * The amount received is `outputAmount` in both fee modes. When fees are taken
 * on the output, the program has already netted them out, so adding them back
 * would credit the trader with fees they actually paid.
 */
export function applyTrade(
  state: AgentState,
  direction: TradeDirection,
  result: SwapResult,
): AgentState {
  const paid = result.includedFeeInputAmount
  const received = result.outputAmount

  if (direction === Direction.QuoteToBase) {
    return {
      ...state,
      quoteBalance: state.quoteBalance - paid,
      baseBalance: state.baseBalance + received,
      costBasisQuote: state.costBasisQuote + paid,
      trades: state.trades + 1,
    }
  }

  // Selling realises a share of the cost basis proportional to the base sold,
  // so an agent that sells half its position keeps half its basis.
  const soldBase = paid
  const basisReleased =
    state.baseBalance > 0n ? (state.costBasisQuote * soldBase) / state.baseBalance : 0n

  return {
    ...state,
    baseBalance: state.baseBalance - soldBase,
    quoteBalance: state.quoteBalance + received,
    costBasisQuote: state.costBasisQuote - basisReleased,
    realisedPnlQuote: state.realisedPnlQuote + (received - basisReleased),
    trades: state.trades + 1,
  }
}

/** Starting holdings for an agent funded with quote and holding no base. */
export function openingPosition(id: string, archetype: string, quoteBalance: bigint): AgentState {
  return {
    id,
    archetype,
    quoteBalance,
    baseBalance: 0n,
    costBasisQuote: 0n,
    realisedPnlQuote: 0n,
    trades: 0,
  }
}
