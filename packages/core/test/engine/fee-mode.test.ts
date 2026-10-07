import { describe, expect, it } from 'vitest'

import { VirtualPool } from '../../src/engine/pool.js'
import {
  ActivationType,
  CollectFeeMode,
  type EngineConfig,
  getFeeMode,
  TradeDirection,
} from '../../src/engine/types.js'

/**
 * Which token a fee is taken in, and whether it comes off the input or the
 * output, decides where every lamport of a launch's revenue lands. The
 * recordings only walk one of the four combinations, so the rest are checked
 * here directly against the table in `FeeMode::get_fee_mode`.
 */
describe('getFeeMode', () => {
  const cases = [
    {
      collect: CollectFeeMode.QuoteToken,
      direction: TradeDirection.QuoteToBase,
      label: 'buying with quote-token fees',
      feesOnInput: true,
      feesOnBaseToken: false,
    },
    {
      collect: CollectFeeMode.QuoteToken,
      direction: TradeDirection.BaseToQuote,
      label: 'selling with quote-token fees',
      feesOnInput: false,
      feesOnBaseToken: false,
    },
    {
      collect: CollectFeeMode.OutputToken,
      direction: TradeDirection.QuoteToBase,
      label: 'buying with output-token fees',
      feesOnInput: false,
      feesOnBaseToken: true,
    },
    {
      collect: CollectFeeMode.OutputToken,
      direction: TradeDirection.BaseToQuote,
      label: 'selling with output-token fees',
      feesOnInput: false,
      feesOnBaseToken: false,
    },
  ] as const

  it.each(cases)('$label', ({ collect, direction, feesOnInput, feesOnBaseToken }) => {
    const mode = getFeeMode(collect, direction, false)
    expect(mode.feesOnInput).toBe(feesOnInput)
    expect(mode.feesOnBaseToken).toBe(feesOnBaseToken)
    expect(mode.hasReferral).toBe(false)
  })

  it('only a quote-token buy takes its fee on the way in', () => {
    const onInput = cases.filter((c) => getFeeMode(c.collect, c.direction, false).feesOnInput)
    expect(onInput).toHaveLength(1)
    expect(onInput[0]!.collect).toBe(CollectFeeMode.QuoteToken)
    expect(onInput[0]!.direction).toBe(TradeDirection.QuoteToBase)
  })

  it('carries the referral flag through unchanged', () => {
    expect(
      getFeeMode(CollectFeeMode.QuoteToken, TradeDirection.QuoteToBase, true).hasReferral,
    ).toBe(true)
  })
})

/**
 * The fee scheduler measures elapsed time from the activation point, but what
 * a "point" counts is per-config. Reading the wrong clock changes every fee a
 * launch charges, and the two are numerically far apart, so a mistake here is
 * not a rounding error.
 */
describe('VirtualPool.currentPoint', () => {
  const configWith = (activationType: number): EngineConfig => ({ activationType }) as EngineConfig

  const clock = { slot: 300_000_000n, unixTimestamp: 1_767_225_600n }

  it('reads slots when the config activates on slots', () => {
    expect(VirtualPool.currentPoint(configWith(ActivationType.Slot), clock)).toBe(clock.slot)
  })

  it('reads wall-clock seconds when the config activates on timestamps', () => {
    expect(VirtualPool.currentPoint(configWith(ActivationType.Timestamp), clock)).toBe(
      clock.unixTimestamp,
    )
  })

  it('does not confuse the two', () => {
    const bySlot = VirtualPool.currentPoint(configWith(ActivationType.Slot), clock)
    const byTimestamp = VirtualPool.currentPoint(configWith(ActivationType.Timestamp), clock)
    expect(bySlot).not.toBe(byTimestamp)
  })
})
