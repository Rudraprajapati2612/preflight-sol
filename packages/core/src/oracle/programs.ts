import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * On-chain programs the oracle loads into LiteSVM.
 *
 * The bytecode is committed under `fixtures/programs/` so that tests run with
 * no network access. `scripts/dump-programs.mjs` refreshes it and verifies the
 * hashes recorded in the manifest.
 */
export interface ProgramFixture {
  readonly name: string
  readonly programId: string
  readonly file: string
  readonly sha256: string
  readonly why: string
}

interface Manifest {
  readonly cluster: string
  readonly dumpedAt: string
  readonly programs: readonly ProgramFixture[]
}

/** Meteora Dynamic Bonding Curve, mainnet and devnet. */
export const DBC_PROGRAM_ID = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'

/**
 * Metaplex Token Metadata. Required, not optional: the DBC program CPIs into it
 * from `initialize_virtual_pool_with_spl_token` to create the base mint's
 * metadata, so pool creation fails if it is not loaded.
 */
export const MPL_TOKEN_METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/programs')

export function loadProgramManifest(): Manifest {
  return JSON.parse(readFileSync(join(fixturesDir, 'manifest.json'), 'utf8')) as Manifest
}

/** Absolute path to a program's committed `.so`. */
export function programBytecodePath(file: string): string {
  return join(fixturesDir, file)
}
