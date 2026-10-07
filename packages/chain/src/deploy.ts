import {
  type ConfigParameters,
  deriveDbcPoolAddress,
  DynamicBondingCurveClient,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import {
  type Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  type Transaction,
} from '@solana/web3.js'

/**
 * Putting a simulated configuration on chain.
 *
 * The point of the tool is the loop: decide what a curve should be, check what
 * it does, and then launch that exact curve. A simulator whose output has to be
 * re-typed into a different tool has a gap in the middle where the thing you
 * tested stops being the thing you shipped.
 *
 * Nothing here invents instructions. Meteora's SDK builds them; this signs and
 * sends, then reads the result back so the deployment can be checked rather
 * than assumed.
 *
 * Deliberately not unit tested. Every line of it sends a transaction, and
 * standing in a mock for the network would test the mock. It is exercised by
 * `pnpm deploy:devnet`, which deploys a real config and pool, reads both
 * accounts back and compares them against what was predicted beforehand. The
 * result of that run, with its signatures, is committed in
 * `docs/devnet-deployment.json` and can be checked on an explorer.
 */

export interface DeployedConfig {
  readonly config: string
  readonly signature: string
}

export interface DeployedPool {
  readonly pool: string
  readonly baseMint: string
  readonly signature: string
}

export interface PoolMetadata {
  readonly name: string
  readonly symbol: string
  readonly uri: string
}

async function send(
  connection: Connection,
  transaction: Transaction,
  payer: Keypair,
  extraSigners: readonly Keypair[] = [],
): Promise<string> {
  return sendAndConfirmTransaction(connection, transaction, [payer, ...extraSigners], {
    commitment: 'confirmed',
  })
}

/**
 * Create the config account a launch will be governed by.
 *
 * The config keypair is generated here and returned: a config is a real account
 * someone has to own, and a caller who cannot say which one was created has no
 * way to launch against it afterwards.
 */
export async function deployConfig(
  connection: Connection,
  params: ConfigParameters,
  payer: Keypair,
  options: { feeClaimer?: PublicKey; leftoverReceiver?: PublicKey } = {},
): Promise<DeployedConfig> {
  const client = new DynamicBondingCurveClient(connection, 'confirmed')
  const config = Keypair.generate()

  const transaction = await client.partner.createConfig({
    config: config.publicKey,
    feeClaimer: options.feeClaimer ?? payer.publicKey,
    leftoverReceiver: options.leftoverReceiver ?? payer.publicKey,
    quoteMint: new PublicKey('So11111111111111111111111111111111111111112'),
    payer: payer.publicKey,
    ...params,
  })

  return {
    config: config.publicKey.toBase58(),
    signature: await send(connection, transaction, payer, [config]),
  }
}

/** Launch a pool against an existing config. */
export async function deployPool(
  connection: Connection,
  configAddress: string,
  metadata: PoolMetadata,
  payer: Keypair,
): Promise<DeployedPool> {
  const client = new DynamicBondingCurveClient(connection, 'confirmed')
  const config = new PublicKey(configAddress)
  const baseMint = Keypair.generate()

  const transaction = await client.creator.createPool({
    ...metadata,
    payer: payer.publicKey,
    poolCreator: payer.publicKey,
    config,
    baseMint: baseMint.publicKey,
  })

  const signature = await send(connection, transaction, payer, [baseMint])

  // Derived rather than searched: the pool is a PDA, so this is exact and needs
  // no scan of the program's accounts.
  const pool = deriveDbcPoolAddress(
    new PublicKey('So11111111111111111111111111111111111111112'),
    baseMint.publicKey,
    config,
  )

  return {
    pool: pool.toBase58(),
    baseMint: baseMint.publicKey.toBase58(),
    signature,
  }
}
