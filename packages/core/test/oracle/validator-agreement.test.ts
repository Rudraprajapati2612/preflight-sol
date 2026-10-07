import { baselineConfig, validateLaunchConfig } from '@preflight/config'
import BN from 'bn.js'
import { describe, expect, it } from 'vitest'

import { DbcOracle } from '../../src/oracle/harness.js'

/**
 * Does the validator agree with the program?
 *
 * A validator that is merely plausible is worse than none: it gives a launcher
 * confidence that the chain does not share. So each case is put to both — the
 * validator's opinion, and the deployed `create_config` running in LiteSVM —
 * and the two have to reach the same verdict.
 */

type Config = ReturnType<typeof baselineConfig>

const broken: ReadonlyArray<{ label: string; mutate: (config: Config) => void }> = [
  {
    label: 'a fee above the program cap',
    mutate: (c) => {
      c.poolFees.baseFee.cliffFeeNumerator = new BN(999_000_000)
    },
  },
  {
    label: 'a fee below the program floor',
    mutate: (c) => {
      c.poolFees.baseFee.cliffFeeNumerator = new BN(1_000)
    },
  },
  {
    label: 'a liquidity split that does not add up',
    mutate: (c) => {
      c.partnerLiquidityPercentage = 80
      c.creatorLiquidityPercentage = 80
    },
  },
  {
    label: 'a creator fee share above 100%',
    mutate: (c) => {
      c.creatorTradingFeePercentage = 150
    },
  },
  {
    label: 'a curve whose segments do not rise',
    mutate: (c) => {
      c.curve = [...c.curve].reverse()
    },
  },
]

describe('validator agreement with the deployed program', () => {
  it('accepts what the program accepts', async () => {
    const oracle = await DbcOracle.create({ seed: 'validator/valid' })
    const config = oracle.configFor()

    expect(validateLaunchConfig(config).valid).toBe(true)
    // And the chain agrees: this does not throw.
    await expect(oracle.createConfig(config)).resolves.toBeDefined()
  })

  it.each(broken)('rejects $label, and so does the program', async ({ label, mutate }) => {
    const oracle = await DbcOracle.create({ seed: `validator/${label}` })
    const config = oracle.configFor()
    mutate(config)

    // Our verdict.
    const result = validateLaunchConfig(config)
    expect(result.valid, `validator should reject ${label}`).toBe(false)
    expect(result.findings.length).toBeGreaterThan(0)

    // The chain's verdict, from the real bytecode.
    await expect(
      oracle.createConfig(config),
      `create_config should reject ${label}`,
    ).rejects.toThrow()
  })
})
