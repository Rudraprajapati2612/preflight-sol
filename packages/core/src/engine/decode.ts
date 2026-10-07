import type { EngineConfig, PoolState, SwapResult, VolatilityTracker } from './types.js'

/**
 * Decode the engine's state out of recorded JSON.
 *
 * Fixtures store every u64 and u128 as a decimal string, because those values
 * routinely exceed `Number.MAX_SAFE_INTEGER` and rounding them would defeat the
 * point of a bit-exact recording. These functions are the inverse of that, and
 * they are deliberately explicit about which fields exist rather than walking
 * the object and guessing which strings were numbers.
 */

type Json = Record<string, unknown>

function obj(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected an object at ${path}, got ${JSON.stringify(value)?.slice(0, 60)}`)
  }
  return value as Json
}

/**
 * Read a numeric field.
 *
 * Accepts the decimal strings a recording stores and the BN objects the SDK
 * hands back, because the same decoder is used for both. BN's `toString` is
 * decimal, unlike its `toJSON`, which is hex — a difference worth naming, since
 * the hex form is what shows up in an error message and makes a perfectly good
 * value look like nonsense.
 */
function big(source: Json, key: string, path: string): bigint {
  const raw = source[key]
  if (typeof raw === 'bigint') return raw
  if (typeof raw === 'number') return BigInt(raw)
  if (typeof raw === 'string' && /^-?\d+$/.test(raw)) return BigInt(raw)
  if (typeof raw === 'object' && raw !== null && 'toString' in raw) {
    const text = String(raw)
    if (/^-?\d+$/.test(text)) return BigInt(text)
  }
  throw new Error(`expected an integer at ${path}.${key}, got ${describe(raw)}`)
}

/** Render a rejected value legibly, without BN's hex `toJSON` confusing things. */
function describe(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'toString' in value) {
    return `"${String(value).slice(0, 40)}"`
  }
  return JSON.stringify(value)?.slice(0, 60) ?? String(value)
}

/** Read a field that is a plain JSON number in the recording. */
function num(source: Json, key: string, path: string): number {
  const raw = source[key]
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && /^-?\d+$/.test(raw)) return Number(raw)
  throw new Error(`expected a number at ${path}.${key}, got ${JSON.stringify(raw)?.slice(0, 60)}`)
}

/**
 * Total base a vesting schedule holds back.
 *
 * `LockedVestingParams::get_total_amount`: the cliff unlock plus every period.
 */
function lockedVestingTotal(value: unknown): bigint {
  if (typeof value !== 'object' || value === null) return 0n
  const vesting = value as Record<string, unknown>
  const read = (key: string): bigint => {
    const raw = vesting[key]
    if (typeof raw === 'bigint') return raw
    if (typeof raw === 'number') return BigInt(raw)
    const text = String(raw ?? '0')
    return /^-?\d+$/.test(text) ? BigInt(text) : 0n
  }
  return read('cliffUnlockAmount') + read('amountPerPeriod') * read('numberOfPeriod')
}

export function decodeConfig(value: unknown): EngineConfig {
  const config = obj(value, 'config')
  const poolFees = obj(config['poolFees'], 'config.poolFees')
  const baseFee = obj(poolFees['baseFee'], 'config.poolFees.baseFee')
  const dynamicFee = obj(poolFees['dynamicFee'], 'config.poolFees.dynamicFee')

  const rawCurve = config['curve']
  if (!Array.isArray(rawCurve)) throw new Error('expected config.curve to be an array')

  return {
    // The trailing zero points that pad the on-chain array are kept, not
    // stripped. Traversal towards the quote side walks the array in reverse and
    // reads `curve[i + 1]`, so dropping the padding would shift every index and
    // silently change how sells are priced. The program skips zero entries
    // itself.
    curve: rawCurve.map((point, index) => {
      const p = obj(point, `config.curve[${index}]`)
      return {
        sqrtPrice: big(p, 'sqrtPrice', `config.curve[${index}]`),
        liquidity: big(p, 'liquidity', `config.curve[${index}]`),
      }
    }),
    sqrtStartPrice: big(config, 'sqrtStartPrice', 'config'),
    migrationQuoteThreshold: big(config, 'migrationQuoteThreshold', 'config'),
    migrationSqrtPrice: big(config, 'migrationSqrtPrice', 'config'),
    collectFeeMode: num(config, 'collectFeeMode', 'config'),
    activationType: num(config, 'activationType', 'config'),
    creatorTradingFeePercentage: num(config, 'creatorTradingFeePercentage', 'config'),
    swapBaseAmount: big(config, 'swapBaseAmount', 'config'),
    migrationBaseThreshold: big(config, 'migrationBaseThreshold', 'config'),
    preMigrationTokenSupply: big(config, 'preMigrationTokenSupply', 'config'),
    fixedTokenSupply: num(config, 'fixedTokenSupplyFlag', 'config') !== 0,
    lockedVestingAmount: lockedVestingTotal(config['lockedVestingConfig']),
    enableFirstSwapWithMinFee: num(config, 'enableFirstSwapWithMinFee', 'config') !== 0,
    poolFees: {
      baseFee: {
        cliffFeeNumerator: big(baseFee, 'cliffFeeNumerator', 'config.poolFees.baseFee'),
        firstFactor: num(baseFee, 'firstFactor', 'config.poolFees.baseFee'),
        secondFactor: big(baseFee, 'secondFactor', 'config.poolFees.baseFee'),
        thirdFactor: big(baseFee, 'thirdFactor', 'config.poolFees.baseFee'),
        baseFeeMode: num(baseFee, 'baseFeeMode', 'config.poolFees.baseFee'),
      },
      dynamicFee: {
        initialized: num(dynamicFee, 'initialized', 'config.poolFees.dynamicFee'),
        maxVolatilityAccumulator: num(
          dynamicFee,
          'maxVolatilityAccumulator',
          'config.poolFees.dynamicFee',
        ),
        variableFeeControl: num(dynamicFee, 'variableFeeControl', 'config.poolFees.dynamicFee'),
        binStep: num(dynamicFee, 'binStep', 'config.poolFees.dynamicFee'),
        filterPeriod: num(dynamicFee, 'filterPeriod', 'config.poolFees.dynamicFee'),
        decayPeriod: num(dynamicFee, 'decayPeriod', 'config.poolFees.dynamicFee'),
        reductionFactor: num(dynamicFee, 'reductionFactor', 'config.poolFees.dynamicFee'),
        binStepU128: big(dynamicFee, 'binStepU128', 'config.poolFees.dynamicFee'),
      },
    },
  }
}

function decodeVolatilityTracker(value: unknown, path: string): VolatilityTracker {
  const tracker = obj(value, path)
  return {
    lastUpdateTimestamp: big(tracker, 'lastUpdateTimestamp', path),
    sqrtPriceReference: big(tracker, 'sqrtPriceReference', path),
    volatilityAccumulator: big(tracker, 'volatilityAccumulator', path),
    volatilityReference: big(tracker, 'volatilityReference', path),
  }
}

/**
 * Decode a pool account. The recording nests the account under `poolState`,
 * matching how the program lays it out, but a bare state object is accepted too.
 */
export function decodePoolState(value: unknown): PoolState {
  const outer = obj(value, 'pool')
  const state = obj(outer['poolState'] ?? outer, 'pool.poolState')
  return {
    sqrtPrice: big(state, 'sqrtPrice', 'pool'),
    baseReserve: big(state, 'baseReserve', 'pool'),
    quoteReserve: big(state, 'quoteReserve', 'pool'),
    protocolBaseFee: big(state, 'protocolBaseFee', 'pool'),
    protocolQuoteFee: big(state, 'protocolQuoteFee', 'pool'),
    partnerBaseFee: big(state, 'partnerBaseFee', 'pool'),
    partnerQuoteFee: big(state, 'partnerQuoteFee', 'pool'),
    creatorBaseFee: big(state, 'creatorBaseFee', 'pool'),
    creatorQuoteFee: big(state, 'creatorQuoteFee', 'pool'),
    activationPoint: big(state, 'activationPoint', 'pool'),
    volatilityTracker: decodeVolatilityTracker(
      state['volatilityTracker'],
      'pool.volatilityTracker',
    ),
    hasSwap: big(state, 'hasSwap', 'pool') !== 0n,
  }
}

/** Decode the `swapResult` carried by a recorded `EvtSwap2`. */
export function decodeSwapResult(value: unknown): SwapResult {
  const result = obj(value, 'swapResult')
  return {
    includedFeeInputAmount: big(result, 'includedFeeInputAmount', 'swapResult'),
    excludedFeeInputAmount: big(result, 'excludedFeeInputAmount', 'swapResult'),
    amountLeft: big(result, 'amountLeft', 'swapResult'),
    outputAmount: big(result, 'outputAmount', 'swapResult'),
    nextSqrtPrice: big(result, 'nextSqrtPrice', 'swapResult'),
    tradingFee: big(result, 'tradingFee', 'swapResult'),
    protocolFee: big(result, 'protocolFee', 'swapResult'),
    referralFee: big(result, 'referralFee', 'swapResult'),
  }
}
