import { engineConfigFromParams } from '@preflight/config'
import { describe, expect, it } from 'vitest'

import { decodeConfig, openingBaseReserve } from '../../src/index.js'
import { DbcOracle } from '../../src/oracle/harness.js'

/**
 * The base a pool actually opens with.
 *
 * A simulated pool has to start from the supply the program would really give
 * it. Standing in a large arbitrary number works — nothing in the pricing
 * depends on it — but then the base reserve shown to anyone reading the result
 * is fiction, and so is any figure derived from it.
 *
 * So the derivation is checked against a pool the program actually created.
 */
describe('opening base reserve', () => {
  it('matches what the program puts in the vault', async () => {
    const oracle = await DbcOracle.create({ seed: 'opening/vault' })
    const params = oracle.configFor()

    const config = await oracle.createConfig(params)
    const handle = await oracle.createPool(config, {
      name: 'Preflight Opening',
      symbol: 'PFV',
      uri: 'https://example.invalid/pfv.json',
    })

    const pool = (await oracle.poolState(handle.pool)) as {
      poolState: { baseReserve: { toString(): string } }
    }
    const actual = BigInt(pool.poolState.baseReserve.toString())

    // Both routes to a config must predict the same opening balance.
    expect(openingBaseReserve(decodeConfig(await oracle.configState(config)))).toBe(actual)
    expect(openingBaseReserve(engineConfigFromParams(params))).toBe(actual)
  })

  it('follows the program rule rather than one rule for every launch', async () => {
    const oracle = await DbcOracle.create({ seed: 'opening/parts' })
    const params = oracle.configFor()
    const config = decodeConfig(await oracle.configState(await oracle.createConfig(params)))

    expect(config.swapBaseAmount).toBeGreaterThan(0n)
    expect(config.migrationBaseThreshold).toBeGreaterThan(0n)

    // This preset states its supply, so the program mints exactly that.
    expect(config.fixedTokenSupply).toBe(true)
    expect(openingBaseReserve(config)).toBe(config.preMigrationTokenSupply)

    // And it is genuinely not the sum of the parts. They differ by the
    // rounding in the swap amount's buffer, so using one rule for both is
    // wrong by an amount that never settles — here, by about 12 million.
    const sumOfParts = config.swapBaseAmount + config.migrationBaseThreshold
    expect(openingBaseReserve(config)).not.toBe(sumOfParts)
    expect(openingBaseReserve(config) - sumOfParts).toBeGreaterThan(0n)
  })
})
