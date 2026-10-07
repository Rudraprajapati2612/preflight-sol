import {
  type ConfigParameters,
  getBaseTokenForSwap,
  getCurveBreakdown,
  getMigrationBaseToken,
  getSwapAmountWithBuffer,
  type MigrationOption,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import type { EngineConfig } from '@preflight/core'

/**
 * Turn built configuration parameters into what the engine runs on.
 *
 * These are two different shapes for the same thing. `ConfigParameters` is what
 * a launcher writes and the SDK builds; `EngineConfig` mirrors the account the
 * program stores, which carries a few fields the program derives rather than
 * accepts — `migrationSqrtPrice` chiefly — and stores flags as integers where
 * the parameters use booleans.
 *
 * Doing the conversion here, once and typed, keeps every consumer from
 * reinventing it and getting `migrationSqrtPrice` wrong, which is easy: it is
 * not the last curve point. Graduation happens where the quote threshold is
 * reached, usually part-way through a segment.
 */
/**
 * Length of the curve array on the config account.
 *
 * The account always carries the full array, zero-padded. That padding is not
 * decoration: traversal towards the quote side walks the array in reverse and
 * reads `curve[i + 1]`, so a shorter array shifts every index and prices sells
 * differently. Built parameters carry only the real points, so they are padded
 * here to match.
 */
const CURVE_ARRAY_LENGTH = 20

export function engineConfigFromParams(params: ConfigParameters): EngineConfig {
  const big = (value: { toString(): string }): bigint => BigInt(value.toString())

  const { finalSqrtPrice } = getCurveBreakdown(
    params.migrationQuoteThreshold,
    params.sqrtStartPrice,
    params.curve,
  )

  const dynamicFee = params.poolFees.dynamicFee

  return {
    curve: Array.from({ length: CURVE_ARRAY_LENGTH }, (_, index) => {
      const point = params.curve[index]
      return point
        ? { sqrtPrice: big(point.sqrtPrice), liquidity: big(point.liquidity) }
        : { sqrtPrice: 0n, liquidity: 0n }
    }),
    sqrtStartPrice: big(params.sqrtStartPrice),
    migrationQuoteThreshold: big(params.migrationQuoteThreshold),
    migrationSqrtPrice: big(finalSqrtPrice),
    collectFeeMode: params.collectFeeMode,
    activationType: params.activationType,
    creatorTradingFeePercentage: params.creatorTradingFeePercentage,
    // The program derives these rather than accepting them, so they are worked
    // out the same way here: what the curve has to sell, and what is held back
    // to seed the pool at graduation. Their sum is the vault's opening balance.
    swapBaseAmount: big(
      getSwapAmountWithBuffer(
        getBaseTokenForSwap(params.sqrtStartPrice, finalSqrtPrice, params.curve),
        params.sqrtStartPrice,
        params.curve,
      ),
    ),
    migrationBaseThreshold: big(
      getMigrationBaseToken(
        params.migrationQuoteThreshold,
        finalSqrtPrice,
        params.migrationOption as MigrationOption,
      ),
    ),
    // A launch that states its supply is treated as fixed by the program, and
    // the vault is minted exactly that rather than the sum of the parts.
    preMigrationTokenSupply: params.tokenSupply
      ? big(params.tokenSupply.preMigrationTokenSupply)
      : 0n,
    fixedTokenSupply: params.tokenSupply !== null && params.tokenSupply !== undefined,
    lockedVestingAmount:
      big(params.lockedVesting.cliffUnlockAmount) +
      big(params.lockedVesting.amountPerPeriod) * big(params.lockedVesting.numberOfPeriod),
    enableFirstSwapWithMinFee: Boolean(params.enableFirstSwapWithMinFee),
    poolFees: {
      baseFee: {
        cliffFeeNumerator: big(params.poolFees.baseFee.cliffFeeNumerator),
        firstFactor: params.poolFees.baseFee.firstFactor,
        secondFactor: big(params.poolFees.baseFee.secondFactor),
        thirdFactor: big(params.poolFees.baseFee.thirdFactor),
        baseFeeMode: params.poolFees.baseFee.baseFeeMode,
      },
      dynamicFee: {
        // The parameters omit the dynamic fee entirely when it is off; the
        // account always has the struct, zeroed.
        initialized: dynamicFee ? 1 : 0,
        maxVolatilityAccumulator: dynamicFee?.maxVolatilityAccumulator ?? 0,
        variableFeeControl: dynamicFee?.variableFeeControl ?? 0,
        binStep: dynamicFee?.binStep ?? 0,
        filterPeriod: dynamicFee?.filterPeriod ?? 0,
        decayPeriod: dynamicFee?.decayPeriod ?? 0,
        reductionFactor: dynamicFee?.reductionFactor ?? 0,
        binStepU128: dynamicFee ? big(dynamicFee.binStepU128) : 0n,
      },
    },
  }
}
