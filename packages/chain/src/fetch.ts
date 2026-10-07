import { Connection, PublicKey } from '@solana/web3.js'

import { decodeLivePool, type LivePool } from './decode.js'

/**
 * Reading a pool that exists.
 *
 * Deliberately thin: the interesting work is decoding, which is tested offline
 * against a real account captured once. This part only moves bytes.
 */

/** Meteora's Dynamic Bonding Curve program, on mainnet and devnet alike. */
export const DBC_PROGRAM_ID = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'

export class PoolNotFoundError extends Error {
  constructor(address: string) {
    super(`No account at ${address}`)
    this.name = 'PoolNotFoundError'
  }
}

export class NotADbcPoolError extends Error {
  constructor(address: string, owner: string) {
    super(`${address} is owned by ${owner}, not by the Dynamic Bonding Curve program`)
    this.name = 'NotADbcPoolError'
  }
}

/**
 * Load a live DBC pool and the config it was launched with.
 *
 * Both accounts are read in one request so they come from the same slot: a pool
 * read at one moment and a config read at another could, in principle,
 * disagree, and the engine would then be simulating a state that never existed.
 */
export async function fetchLivePool(
  connection: Connection,
  poolAddress: string,
): Promise<LivePool> {
  const pool = new PublicKey(poolAddress)
  const poolAccount = await connection.getAccountInfo(pool)
  if (!poolAccount) throw new PoolNotFoundError(poolAddress)
  if (poolAccount.owner.toBase58() !== DBC_PROGRAM_ID) {
    throw new NotADbcPoolError(poolAddress, poolAccount.owner.toBase58())
  }

  // The config key sits after the volatility tracker at the head of the account.
  const configAddress = configAddressOf(poolAccount.data)
  const configAccount = await connection.getAccountInfo(new PublicKey(configAddress))
  if (!configAccount) throw new PoolNotFoundError(configAddress)

  return decodeLivePool(poolAccount.data, configAccount.data)
}

/**
 * Read the config key straight out of the pool's bytes.
 *
 * Saves a decode just to learn which second account to ask for. The layout is
 * fixed: an 8-byte discriminator, then the 64-byte volatility tracker, then the
 * config public key.
 */
export function configAddressOf(poolData: Buffer): string {
  const offset = 8 + 64
  return new PublicKey(poolData.subarray(offset, offset + 32)).toBase58()
}
