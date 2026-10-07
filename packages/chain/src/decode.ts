import { createDbcProgram } from '@meteora-ag/dynamic-bonding-curve-sdk'
import { decodeConfig, type EngineConfig, type PoolState } from '@preflight/core'
import type { Connection } from '@solana/web3.js'

/**
 * Turning bytes from the chain into something the engine can run.
 *
 * Decoding is kept separate from fetching on purpose. A pool account is just
 * bytes, and being able to decode them without a network connection means the
 * tests that prove the decoding is right can run offline, against a real
 * account captured once and committed.
 */

/** Anchor's account coder, obtained without a live endpoint. */
function coder() {
  // The program object only needs a Connection to *send* things. Decoding
  // reads no accounts, so a stub is enough and keeps this usable in a browser.
  const stub = { commitment: 'confirmed', rpcEndpoint: 'offline://' } as unknown as Connection
  return createDbcProgram(stub, 'confirmed').program.coder.accounts
}

export interface LivePool {
  readonly config: EngineConfig
  readonly state: PoolState
  /** What the program stores beyond what the engine needs. */
  readonly meta: {
    readonly baseMint: string
    /** Taken from the config: the pool account records a vault, not a mint. */
    readonly quoteMint: string
    readonly creator: string
    readonly isMigrated: boolean
    readonly activationPoint: bigint
  }
}

/** Decode a `VirtualPool` account into the engine's pool state. */
export function decodeVirtualPool(data: Buffer): {
  state: PoolState
  meta: LivePool['meta']
} {
  const decoded = coder().decode('virtualPool', data) as {
    poolState: Record<string, { toString(): string } | number | string>
  }
  const pool = decoded.poolState
  const big = (key: string): bigint => BigInt(String(pool[key]))
  const tracker = pool['volatilityTracker'] as unknown as Record<string, { toString(): string }>

  return {
    state: {
      sqrtPrice: big('sqrtPrice'),
      baseReserve: big('baseReserve'),
      quoteReserve: big('quoteReserve'),
      protocolBaseFee: big('protocolBaseFee'),
      protocolQuoteFee: big('protocolQuoteFee'),
      partnerBaseFee: big('partnerBaseFee'),
      partnerQuoteFee: big('partnerQuoteFee'),
      creatorBaseFee: big('creatorBaseFee'),
      creatorQuoteFee: big('creatorQuoteFee'),
      activationPoint: big('activationPoint'),
      volatilityTracker: {
        lastUpdateTimestamp: BigInt(String(tracker['lastUpdateTimestamp'])),
        sqrtPriceReference: BigInt(String(tracker['sqrtPriceReference'])),
        volatilityAccumulator: BigInt(String(tracker['volatilityAccumulator'])),
        volatilityReference: BigInt(String(tracker['volatilityReference'])),
      },
      hasSwap: Number(pool['hasSwap']) !== 0,
    },
    meta: {
      baseMint: String(pool['baseMint']),
      // The pool holds a quote *vault*; which mint that vault is for lives on
      // the config, and is filled in by the caller that has both.
      quoteMint: '',
      creator: String(pool['creator']),
      isMigrated: Number(pool['isMigrated']) !== 0,
      activationPoint: big('activationPoint'),
    },
  }
}

/**
 * Decode a `PoolConfig` account into the engine's configuration.
 *
 * `decodeConfig` was written against exactly this shape — the account as the
 * program stores it — which is why a config read from the chain and one read
 * from a recording go through the same code.
 */
export function decodePoolConfig(data: Buffer): EngineConfig {
  return decodeConfig(coder().decode('poolConfig', data))
}

/** Decode both halves of a live pool. */
export function decodeLivePool(poolData: Buffer, configData: Buffer): LivePool {
  const { state, meta } = decodeVirtualPool(poolData)
  const decodedConfig = coder().decode('poolConfig', configData) as Record<string, unknown>
  return {
    config: decodeConfig(decodedConfig),
    state,
    meta: { ...meta, quoteMint: String(decodedConfig['quoteMint'] ?? '') },
  }
}
