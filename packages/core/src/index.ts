/**
 * @preflight/core — the Meteora DBC simulation engine.
 *
 * Architectural invariant: the engine operates exclusively in **raw atomic
 * units**. It must never depend on token decimals, ticker symbols, or fiat
 * prices. Those belong to the configuration, metrics, and UI layers.
 *
 * That invariant is what makes the engine quote-asset agnostic by
 * construction: a curve quoted in SOL, USDC, or a tokenized equity is the same
 * arithmetic, and no code path branches on which asset is being used.
 *
 * The engine is validated by replaying recordings made from Meteora's deployed
 * program. Those recordings are produced by the oracle, which lives behind a
 * separate entry point (`@preflight/core/oracle`) because it loads LiteSVM and
 * real bytecode and therefore only runs under Node. The engine itself is plain
 * arithmetic and runs anywhere, including a browser.
 */

export { VirtualPool } from './engine/pool.js'
export type { SwapOptions, SwapOutcome } from './engine/pool.js'
export { decodeConfig, decodePoolState, decodeSwapResult } from './engine/decode.js'
export {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  getFeeMode,
  openingBaseReserve,
  TradeDirection,
} from './engine/types.js'
export type {
  CurvePoint,
  EngineConfig,
  FeeMode,
  PoolState,
  SwapResult,
  VolatilityTracker,
} from './engine/types.js'

/** Identifier for this package, used by the toolchain smoke test. */
export const PACKAGE_NAME = '@preflight/core'
