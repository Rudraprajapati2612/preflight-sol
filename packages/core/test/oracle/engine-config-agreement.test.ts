import { engineConfigFromParams } from '@preflight/config'
import { describe, expect, it } from 'vitest'

import { decodeConfig } from '../../src/engine/decode.js'
import { DbcOracle } from '../../src/oracle/harness.js'

/**
 * Two routes to the same engine configuration, checked against each other.
 *
 * A launcher's configuration can reach the engine two ways: built locally from
 * parameters, before anything is on chain, or decoded from the account the
 * program created. The simulator is only trustworthy if those agree — a
 * launcher who simulates a curve and then deploys it must get the curve they
 * simulated.
 *
 * The program derives `migrationSqrtPrice` itself, so this also re-checks the
 * thing that is easy to get wrong: it is where the quote threshold is reached,
 * not the end of the last curve segment.
 */
describe('building a config locally agrees with decoding the deployed one', () => {
  it('produces an identical engine configuration', async () => {
    const oracle = await DbcOracle.create({ seed: 'engine-config/agreement' })
    const params = oracle.configFor()

    const built = engineConfigFromParams(params)

    const address = await oracle.createConfig(params)
    const decoded = decodeConfig(await oracle.configState(address))

    expect(built.sqrtStartPrice).toBe(decoded.sqrtStartPrice)
    expect(built.migrationQuoteThreshold).toBe(decoded.migrationQuoteThreshold)
    expect(built.migrationSqrtPrice).toBe(decoded.migrationSqrtPrice)
    expect(built.collectFeeMode).toBe(decoded.collectFeeMode)
    expect(built.activationType).toBe(decoded.activationType)
    expect(built.creatorTradingFeePercentage).toBe(decoded.creatorTradingFeePercentage)
    expect(built.enableFirstSwapWithMinFee).toBe(decoded.enableFirstSwapWithMinFee)
    expect(built.poolFees.baseFee).toEqual(decoded.poolFees.baseFee)
    expect(built.poolFees.dynamicFee).toEqual(decoded.poolFees.dynamicFee)

    // Curve points must line up one for one, padding included: the traversal
    // towards the quote side indexes into this array.
    expect(built.curve.length).toBe(decoded.curve.length)
    expect(built.curve).toEqual(decoded.curve)
  })

  it('agrees for a launch with the dynamic fee switched on', async () => {
    const oracle = await DbcOracle.create({ seed: 'engine-config/dynamic' })
    const params = oracle.configFor({ dynamicFee: true })

    const built = engineConfigFromParams(params)
    const decoded = decodeConfig(await oracle.configState(await oracle.createConfig(params)))

    expect(built.poolFees.dynamicFee).toEqual(decoded.poolFees.dynamicFee)
    expect(built.migrationSqrtPrice).toBe(decoded.migrationSqrtPrice)
  })
})
