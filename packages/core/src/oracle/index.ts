/**
 * The oracle: Meteora's deployed program, running in-process.
 *
 * Deliberately a separate entry point from the engine. It loads LiteSVM and
 * real program bytecode, which only works under Node, while the engine is
 * plain arithmetic that has to run in a browser too. Keeping them apart means
 * importing the engine cannot drag a test harness into a web bundle.
 */

export { DbcOracle } from './harness.js'
export type { OracleOptions, PoolHandle, SwapObservation } from './harness.js'
export {
  buildBaselineFixture,
  buildDynamicFeeFixture,
  buildExactOutFixture,
  buildFeeDecayFixture,
  buildOutputFeeFixture,
  dbcProgramSha256,
} from './fixtures.js'
export type { OracleFixture, SwapRecord } from './fixtures.js'
export { decodeAnchorEvents, findEvent } from './events.js'
export type { DecodedEvent, EventCoder } from './events.js'
export {
  DBC_PROGRAM_ID,
  loadProgramManifest,
  MPL_TOKEN_METADATA_PROGRAM_ID,
  programBytecodePath,
} from './programs.js'
export type { ProgramFixture } from './programs.js'
export { createSvmConnection } from './svm-connection.js'
export { sendInstructions, toKitInstruction, TransactionFailedError } from './tx.js'
export { toJson } from './serialize.js'
export type { Json } from './serialize.js'
