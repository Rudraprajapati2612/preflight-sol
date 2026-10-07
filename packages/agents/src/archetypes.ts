import { TradeDirection } from '@preflight/core'

import type { Agent, AgentContext, TradeIntent } from './types.js'

/**
 * The kinds of people who show up to a launch.
 *
 * These are caricatures on purpose. The question a launcher is asking is not
 * "what will happen" — nobody can answer that — but "how does this curve behave
 * when the first buyer is enormous and instant, or when everyone sells at
 * once". A small set of legible, extreme behaviours answers that better than an
 * elaborate model whose output nobody can attribute to a cause.
 */

/**
 * Buys immediately and large, then sells as soon as it is up enough.
 *
 * This is the behaviour most likely to embarrass a curve: if a sniper can take
 * a third of the supply in the first second and exit into the people who
 * arrive next, the curve is too cheap at the start, and that is exactly the
 * thing worth seeing before launch rather than after.
 */
export function sniper(
  id: string,
  options: {
    size: bigint
    exitMultiple: number
    /**
     * The most a sniper will pay to get in, as a fraction. Above this it waits
     * rather than bidding.
     *
     * This is the whole point of a fee scheduler, and without it the schedule
     * is decoration: a bot that buys at t=0 whatever the fee is cannot be
     * deterred by making t=0 expensive. A sniper that waits is not a sniper
     * that was stopped — it is one that arrives after the cheap end of the
     * curve has already been sold to somebody else, which is the outcome the
     * fee was bought for.
     *
     * Left undefined, the sniper ignores the fee, which is the old behaviour.
     */
    maxEntryFee?: number
  },
): Agent {
  return {
    id,
    archetype: 'sniper',
    decide(context: AgentContext): TradeIntent | null {
      const { self, random } = context

      if (self.baseBalance > 0n) {
        // Exit once the position is worth the target multiple of what it cost.
        const value = valueOfBase(context, self.baseBalance)
        if (
          value >=
          (self.costBasisQuote * BigInt(Math.round(options.exitMultiple * 100))) / 100n
        ) {
          return {
            direction: TradeDirection.BaseToQuote,
            amountIn: self.baseBalance,
            partialFill: true,
            delaySeconds: BigInt(random.intBetween(0, 2)),
          }
        }
        return null
      }

      if (self.trades > 0 || self.quoteBalance < options.size) return null

      // Too expensive to be first: sit the round out and look again. Whether
      // the fee ever falls far enough is the configuration's business, not the
      // agent's — under a flat fee this waits forever, which is the correct
      // behaviour and is exactly what a flat high fee is for.
      if (options.maxEntryFee !== undefined && context.baseFeeFraction > options.maxEntryFee) {
        return null
      }

      // In first, ahead of everyone.
      return {
        direction: TradeDirection.QuoteToBase,
        amountIn: options.size,
        partialFill: true,
        delaySeconds: 0n,
      }
    },
  }
}

/**
 * Occasional very large buys, spaced out.
 *
 * A whale does not move first, but when it moves it moves the price on its own,
 * which is what makes the rest of the curve's shape matter.
 */
export function whale(
  id: string,
  options: { size: bigint; minGapSeconds: number; maxGapSeconds: number; patience: number },
): Agent {
  return {
    id,
    archetype: 'whale',
    decide({ self, random, isCurveComplete }: AgentContext): TradeIntent | null {
      if (isCurveComplete || self.quoteBalance <= 0n) return null
      if (!random.chance(options.patience)) return null

      const size = self.quoteBalance < options.size ? self.quoteBalance : options.size
      if (size <= 0n) return null

      return {
        direction: TradeDirection.QuoteToBase,
        amountIn: size,
        partialFill: true,
        delaySeconds: BigInt(random.intBetween(options.minGapSeconds, options.maxGapSeconds)),
      }
    },
  }
}

/**
 * Small, frequent, and sometimes sells.
 *
 * Organic flow is what a launch is supposed to attract, and it is the group
 * that suffers when a curve is shaped so that the early buyers own everything.
 */
export function organic(
  id: string,
  options: { minSize: bigint; maxSize: bigint; sellChance: number; activity: number },
): Agent {
  return {
    id,
    archetype: 'organic',
    decide({ self, random, isCurveComplete }: AgentContext): TradeIntent | null {
      if (isCurveComplete) return null
      if (!random.chance(options.activity)) return null

      const wantsToSell = self.baseBalance > 0n && random.chance(options.sellChance)
      if (wantsToSell) {
        // Sells a slice rather than the lot; this is not a panic.
        const fraction = BigInt(random.intBetween(10, 60))
        const amount = (self.baseBalance * fraction) / 100n
        if (amount <= 0n) return null
        return {
          direction: TradeDirection.BaseToQuote,
          amountIn: amount,
          partialFill: true,
          delaySeconds: BigInt(random.intBetween(1, 40)),
        }
      }

      const size = random.bigintBetween(options.minSize, options.maxSize)
      if (size <= 0n || self.quoteBalance < size) return null
      return {
        direction: TradeDirection.QuoteToBase,
        amountIn: size,
        partialFill: true,
        delaySeconds: BigInt(random.intBetween(1, 40)),
      }
    },
  }
}

/**
 * What the agent's base holding would fetch at the current price, ignoring the
 * impact of selling it. Good enough for an exit rule, and deliberately not
 * presented as a valuation.
 */
function valueOfBase(context: AgentContext, baseAmount: bigint): bigint {
  const sqrtPrice = context.pool.sqrtPrice
  // price = sqrtPrice^2 / 2^128, in atomic units of quote per atomic base.
  return (baseAmount * sqrtPrice * sqrtPrice) >> 128n
}
