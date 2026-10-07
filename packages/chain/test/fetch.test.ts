import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Connection, PublicKey } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'

import { DBC_PROGRAM_ID, fetchLivePool, NotADbcPoolError, PoolNotFoundError } from '../src/index.js'

/**
 * The fetch path, exercised without a network.
 *
 * A stub connection serves the same bytes that were captured from mainnet, so
 * the whole path — read the pool, find its config, decode both — is covered
 * while the test suite stays offline and deterministic.
 */

const captured = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../core/fixtures/mainnet/live-pool.json'),
    'utf8',
  ),
) as {
  pool: { address: string; data: string; owner: string }
  config: { address: string; data: string; owner: string }
}

/** Serves only the two accounts that were captured; anything else is absent. */
function stubConnection(overrides: Record<string, unknown> = {}): Connection {
  const accounts: Record<string, unknown> = {
    [captured.pool.address]: {
      data: Buffer.from(captured.pool.data, 'base64'),
      owner: new PublicKey(captured.pool.owner),
      executable: false,
      lamports: 1,
      rentEpoch: 0,
    },
    [captured.config.address]: {
      data: Buffer.from(captured.config.data, 'base64'),
      owner: new PublicKey(captured.config.owner),
      executable: false,
      lamports: 1,
      rentEpoch: 0,
    },
    ...overrides,
  }
  return {
    getAccountInfo: (key: PublicKey) => Promise.resolve(accounts[key.toBase58()] ?? null),
  } as unknown as Connection
}

const ABSENT = '11111111111111111111111111111112'

describe('fetchLivePool', () => {
  it('loads a pool and the config it was launched with', async () => {
    const live = await fetchLivePool(stubConnection(), captured.pool.address)

    expect(live.state.quoteReserve).toBeGreaterThan(0n)
    expect(live.config.migrationQuoteThreshold).toBeGreaterThan(0n)
    expect(live.meta.baseMint).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
  })

  it('says so plainly when there is no account there', async () => {
    await expect(fetchLivePool(stubConnection(), ABSENT)).rejects.toBeInstanceOf(PoolNotFoundError)
  })

  it('refuses an account that belongs to some other program', async () => {
    // Pointing this at a token account or an AMM pool is an easy mistake, and
    // decoding it anyway would produce confident nonsense rather than an error.
    const connection = stubConnection({
      [captured.pool.address]: {
        data: Buffer.from(captured.pool.data, 'base64'),
        owner: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        executable: false,
        lamports: 1,
        rentEpoch: 0,
      },
    })
    await expect(fetchLivePool(connection, captured.pool.address)).rejects.toBeInstanceOf(
      NotADbcPoolError,
    )
  })

  it('reports a missing config rather than decoding a pool half way', async () => {
    const connection = stubConnection({ [captured.config.address]: null })
    await expect(fetchLivePool(connection, captured.pool.address)).rejects.toBeInstanceOf(
      PoolNotFoundError,
    )
  })

  it('names the program it expects', () => {
    expect(DBC_PROGRAM_ID).toBe('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN')
    expect(captured.pool.owner).toBe(DBC_PROGRAM_ID)
  })
})
