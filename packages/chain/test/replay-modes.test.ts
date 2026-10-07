import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodeConfig, type EngineConfig } from '@preflight/core'
import type { OracleFixture } from '@preflight/core/oracle'
import { describe, expect, it } from 'vitest'

import { openingState, type RecordedSwap, replayLaunch, SwapMode } from '../src/index.js'

/**
 * The replay's own behaviour, rather than the engine's.
 *
 * A replay reports on itself — how many swaps it reproduced, where it stopped,
 * which field disagreed — and those reports are what anyone reads. If they are
 * wrong the replay can claim a clean run it never had.
 */

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../core/fixtures/oracle/exact-out.json'),
    'utf8',
  ),
) as OracleFixture
const config: EngineConfig = decodeConfig(fixture.configAccount)

/** Build a recorded swap from the exact-out recording, which has both modes. */
function recorded(index: number): RecordedSwap {
  const swap = fixture.swaps[index]!
  const event = swap.event as { swapResult: Record<string, string>; quoteReserveAmount: string }
  const result = event.swapResult
  return {
    pool: 'pool',
    signature: `sig-${index}`,
    slot: index,
    transactionIndex: 0,
    blockTime: 0,
    tradeDirection: 1,
    amount0: BigInt(swap.amountIn),
    swapMode:
      swap.kind === 'exactOut'
        ? SwapMode.ExactOut
        : swap.kind === 'partialFill'
          ? SwapMode.PartialFill
          : SwapMode.ExactIn,
    result: {
      includedFeeInputAmount: BigInt(result['includedFeeInputAmount']!),
      excludedFeeInputAmount: BigInt(result['excludedFeeInputAmount']!),
      amountLeft: BigInt(result['amountLeft']!),
      outputAmount: BigInt(result['outputAmount']!),
      nextSqrtPrice: BigInt(result['nextSqrtPrice']!),
      tradingFee: BigInt(result['tradingFee']!),
      protocolFee: BigInt(result['protocolFee']!),
      referralFee: BigInt(result['referralFee']!),
    },
    quoteReserveAmount: BigInt(event.quoteReserveAmount),
    currentTimestamp: BigInt(swap.clock.unixTimestamp),
  }
}

const swaps = fixture.swaps.map((_, index) => recorded(index))

describe('replayLaunch', () => {
  it('reproduces a launch mixing exact-in and exact-out', () => {
    const report = replayLaunch('pool', config, swaps)
    expect(report.divergences).toEqual([])
    expect(report.exact).toBe(true)
    expect(report.swapsReplayed).toBe(swaps.length)
    expect(report.unsupported).toEqual([])
  })

  it('names the field that disagreed rather than only that one did', () => {
    const tampered = swaps.map((swap, index) =>
      index === 1
        ? { ...swap, result: { ...swap.result, outputAmount: swap.result.outputAmount + 1n } }
        : swap,
    )
    const report = replayLaunch('pool', config, tampered)

    expect(report.exact).toBe(false)
    const divergence = report.divergences.find((d) => d.field === 'outputAmount')
    expect(divergence).toBeDefined()
    expect(divergence!.step).toBe(1)
    expect(divergence!.signature).toBe('sig-1')
  })

  it('catches a running total that drifts even when each swap is right', () => {
    // An engine can price every trade correctly and still lose the reserve.
    const tampered = swaps.map((swap, index) =>
      index === 2 ? { ...swap, quoteReserveAmount: swap.quoteReserveAmount + 1000n } : swap,
    )
    const report = replayLaunch('pool', config, tampered)
    expect(report.divergences.some((d) => d.field === 'quoteReserve')).toBe(true)
  })

  it('stops and reports when a swap cannot be priced at all', () => {
    // Far more than the curve holds, demanded outright rather than offered.
    const impossible: RecordedSwap[] = [
      { ...swaps[0]!, swapMode: SwapMode.ExactOut, amount0: 2n ** 62n },
    ]
    const report = replayLaunch('pool', config, impossible)
    expect(report.exact).toBe(false)
    expect(report.divergences[0]!.field).toBe('error')
  })

  it('reports nothing to reproduce for a launch with no swaps', () => {
    const report = replayLaunch('pool', config, [])
    expect(report.swapsReplayed).toBe(0)
    expect(report.fieldsCompared).toBe(0)
    expect(report.exact).toBe(true)
  })
})

describe('openingState', () => {
  it('starts a pool at the beginning of its curve, untouched', () => {
    const state = openingState(config, 1_000n)
    expect(state.sqrtPrice).toBe(config.sqrtStartPrice)
    expect(state.quoteReserve).toBe(0n)
    expect(state.hasSwap).toBe(false)
    expect(state.volatilityTracker.sqrtPriceReference).toBe(config.sqrtStartPrice)
    expect(state.activationPoint).toBe(1_000n)
  })
})
