import { describe, expect, it } from 'vitest'
import BN from 'bn.js'

import { DbcOracle } from '../../src/oracle/harness.js'
import { baselineConfig } from '@preflight/config'

/**
 * These tests execute Meteora's deployed bytecode. They are the reference the
 * simulation engine will be measured against, so the assertions deliberately
 * check values derived from the program's source rather than from the SDK,
 * which would otherwise be marking its own homework.
 */

/** Shape of the parts of `EvtSwap2` these tests assert on. */
interface SwapEvent {
  tradeDirection: number
  swapResult: {
    includedFeeInputAmount: BN
    excludedFeeInputAmount: BN
    amountLeft: BN
    outputAmount: BN
    nextSqrtPrice: BN
    tradingFee: BN
    protocolFee: BN
    referralFee: BN
  }
  quoteReserveAmount: BN
  migrationThreshold: BN
  currentTimestamp: BN
}

const ONE_QUOTE = 1_000_000_000n // 1 token at 9 decimals

async function openPool() {
  const oracle = await DbcOracle.create()
  const params = baselineConfig()
  const config = await oracle.createConfig(params)
  const handle = await oracle.createPool(config, {
    name: 'Preflight Reference',
    symbol: 'PFR',
    uri: 'https://example.invalid/pfr.json',
  })
  await oracle.fundQuote(oracle.payer.publicKey, 500n * ONE_QUOTE)
  return { oracle, params, handle }
}

describe('DbcOracle', () => {
  it('runs the real DBC program: config, pool and a swap all execute', async () => {
    const { oracle, handle } = await openPool()
    const observation = await oracle.swap(handle, {
      amountIn: ONE_QUOTE,
      swapBaseForQuote: false,
    })

    expect(observation.event).not.toBeNull()
    expect(observation.legacyEvent).not.toBeNull()
    const event = observation.event as SwapEvent

    // TradeDirection::QuoteToBase is 1 in the program's enum.
    expect(event.tradeDirection).toBe(1)
    // A buy moves the curve, so some base token must come out.
    expect(BigInt(event.swapResult.outputAmount.toString())).toBeGreaterThan(0n)
    // Exact-in with sufficient liquidity must consume the whole input.
    expect(event.swapResult.amountLeft.toString()).toBe('0')
  })

  it('splits fees the way the program does: 1% total, 20% of it to the protocol', async () => {
    const { oracle, handle } = await openPool()
    const { event } = await oracle.swap(handle, {
      amountIn: ONE_QUOTE,
      swapBaseForQuote: false,
    })
    const result = (event as SwapEvent).swapResult

    const included = BigInt(result.includedFeeInputAmount.toString())
    const excluded = BigInt(result.excludedFeeInputAmount.toString())
    const trading = BigInt(result.tradingFee.toString())
    const protocol = BigInt(result.protocolFee.toString())
    const referral = BigInt(result.referralFee.toString())

    expect(included).toBe(ONE_QUOTE)
    // The config sets a flat 100 bps base fee.
    const totalFee = included - excluded
    expect(totalFee).toBe(ONE_QUOTE / 100n)
    // PROTOCOL_FEE_PERCENT is 20, taken out of the trading fee.
    expect(protocol).toBe(totalFee / 5n)
    expect(trading).toBe(totalFee - protocol)
    // No referral was supplied, so that share stays zero.
    expect(referral).toBe(0n)
    // Fees are collected in the quote token, so every component is accounted for.
    expect(excluded + trading + protocol + referral).toBe(included)
  })

  it('moves the price up on a buy and credits the reserve net of fees', async () => {
    const { oracle, params, handle } = await openPool()
    const { event } = await oracle.swap(handle, {
      amountIn: 5n * ONE_QUOTE,
      swapBaseForQuote: false,
    })
    const swap = event as SwapEvent

    const startSqrtPrice = BigInt(params.sqrtStartPrice.toString())
    const nextSqrtPrice = BigInt(swap.swapResult.nextSqrtPrice.toString())
    expect(nextSqrtPrice).toBeGreaterThan(startSqrtPrice)

    // In QuoteToken fee mode the fee is taken on input, so the reserve grows by
    // the fee-exclusive amount, not by what the trader sent.
    expect(swap.quoteReserveAmount.toString()).toBe(
      swap.swapResult.excludedFeeInputAmount.toString(),
    )
    expect(swap.migrationThreshold.toString()).toBe(params.migrationQuoteThreshold.toString())
  })

  it('advances the clock, which the fee scheduler and volatility decay both read', async () => {
    const oracle = await DbcOracle.create()
    const before = oracle.clock()
    oracle.advanceSeconds(120n)
    const after = oracle.clock()

    expect(after.unixTimestamp - before.unixTimestamp).toBe(120n)
    // 400ms slots: 120 seconds is 300 slots.
    expect(after.slot - before.slot).toBe(300n)
  })
})
