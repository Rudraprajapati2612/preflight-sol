import {
  type ConfigParameters,
  validateConfigParameters,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import { PublicKey } from '@solana/web3.js'

import { type QuoteAsset, quoteMintEligibility } from './quote-asset.js'

/**
 * Does the program accept this configuration, and if not, why?
 *
 * The SDK already validates against `create_config`, but it throws on the first
 * problem and says only "Invalid pool fees". A launcher deciding how to shape a
 * curve needs every problem at once and needs to know the actual limit, so this
 * runs its own checks first with the numbers spelled out, then defers to the
 * SDK as a backstop for anything not covered here.
 *
 * It also checks something the SDK does not: whether the quote mint can be used
 * at all, which for a tokenized equity is the question that decides everything
 * else.
 */

/** Fee bounds from the program's `constants::fee`. */
const MIN_FEE_NUMERATOR = 2_500_000n // 0.25%
const MAX_FEE_NUMERATOR = 990_000_000n // 99%
const FEE_DENOMINATOR = 1_000_000_000n

/**
 * A stand-in for a field the configuration itself does not carry.
 *
 * The SDK's validator takes the whole `create_config` argument, including who
 * receives leftover tokens, which is a deployment choice rather than part of
 * the curve. Any real address will do — but not `PublicKey.default`, which the
 * SDK rejects while reporting "Invalid token supply", a message about an
 * entirely different field.
 */
const PLACEHOLDER_LEFTOVER_RECEIVER = new PublicKey('So11111111111111111111111111111111111111112')

export type Severity = 'error' | 'warning'

export interface Finding {
  readonly severity: Severity
  /** Stable identifier, so a UI can key off it rather than off prose. */
  readonly code: string
  readonly message: string
  readonly field?: string
}

export interface ValidationResult {
  /** False if any finding is an error. Warnings do not block a launch. */
  readonly valid: boolean
  readonly findings: readonly Finding[]
}

const asBig = (value: { toString(): string }): bigint => BigInt(value.toString())

const feePercent = (numerator: bigint): string =>
  `${(Number((numerator * 10_000n) / FEE_DENOMINATOR) / 100).toFixed(4)}%`

/**
 * Validate a built configuration, optionally against the asset it will be
 * quoted in.
 */
export function validateLaunchConfig(
  config: ConfigParameters,
  quoteAsset?: QuoteAsset,
): ValidationResult {
  const findings: Finding[] = []

  const cliff = asBig(config.poolFees.baseFee.cliffFeeNumerator)
  if (cliff > MAX_FEE_NUMERATOR) {
    findings.push({
      severity: 'error',
      code: 'fee-above-maximum',
      field: 'poolFees.baseFee.cliffFeeNumerator',
      message:
        `The starting fee is ${feePercent(cliff)}, above the 99% the program allows. ` +
        'A fee at that level also leaves almost nothing for the curve.',
    })
  } else if (cliff < MIN_FEE_NUMERATOR) {
    findings.push({
      severity: 'error',
      code: 'fee-below-minimum',
      field: 'poolFees.baseFee.cliffFeeNumerator',
      message: `The starting fee is ${feePercent(cliff)}, below the 0.25% floor the program enforces.`,
    })
  }

  const creatorFee = config.creatorTradingFeePercentage
  if (creatorFee < 0 || creatorFee > 100) {
    findings.push({
      severity: 'error',
      code: 'creator-fee-share-out-of-range',
      field: 'creatorTradingFeePercentage',
      message: `The creator's share of trading fees is ${creatorFee}%, which must be between 0 and 100.`,
    })
  }

  const lpTotal =
    config.partnerLiquidityPercentage +
    config.partnerPermanentLockedLiquidityPercentage +
    config.creatorLiquidityPercentage +
    config.creatorPermanentLockedLiquidityPercentage
  if (lpTotal !== 100) {
    findings.push({
      severity: 'error',
      code: 'liquidity-split-not-whole',
      field: 'liquidityDistribution',
      message:
        `Migrated liquidity is split ${lpTotal}% rather than 100%. Partner and creator ` +
        'shares, locked and unlocked, have to account for all of it.',
    })
  }

  if (asBig(config.migrationQuoteThreshold) <= 0n) {
    findings.push({
      severity: 'error',
      code: 'migration-threshold-not-positive',
      field: 'migrationQuoteThreshold',
      message: 'The migration threshold is zero, so the curve could never graduate.',
    })
  }

  const points = config.curve.filter((point) => asBig(point.sqrtPrice) > 0n)
  if (points.length === 0) {
    findings.push({
      severity: 'error',
      code: 'curve-empty',
      field: 'curve',
      message: 'The curve has no segments, so there is nothing to trade against.',
    })
  } else {
    let previous = asBig(config.sqrtStartPrice)
    for (const [index, point] of points.entries()) {
      const price = asBig(point.sqrtPrice)
      if (price <= previous) {
        findings.push({
          severity: 'error',
          code: 'curve-not-ascending',
          field: `curve[${index}].sqrtPrice`,
          message:
            `Curve segment ${index} starts at or below the previous price. Segments have to ` +
            'rise in price order for the curve to be traversable.',
        })
        break
      }
      previous = price
    }
  }

  if (quoteAsset) {
    const eligibility = quoteMintEligibility(quoteAsset)
    if (!eligibility.eligible) {
      findings.push({
        severity: 'error',
        code: 'quote-mint-ineligible',
        field: 'quoteMint',
        message: eligibility.reason,
      })
    } else if (eligibility.requiresTokenBadge) {
      // A warning rather than an error: the configuration is sound, but it
      // cannot be launched until Meteora badges the mint. That is a
      // conversation to have, not a number to change.
      findings.push({
        severity: 'warning',
        code: 'quote-mint-requires-token-badge',
        field: 'quoteMint',
        message: eligibility.reason,
      })
    }
  }

  // Backstop. Anything the checks above miss should still be caught, even if
  // the message is terser than one written here.
  if (!findings.some((finding) => finding.severity === 'error')) {
    try {
      validateConfigParameters({
        ...config,
        leftoverReceiver: PLACEHOLDER_LEFTOVER_RECEIVER,
      })
    } catch (error) {
      findings.push({
        severity: 'error',
        code: 'program-would-reject',
        message: `The program would reject this configuration: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    }
  }

  return {
    valid: !findings.some((finding) => finding.severity === 'error'),
    findings,
  }
}
