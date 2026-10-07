#!/usr/bin/env node
/**
 * Deploy a simulated curve to devnet, then read it back.
 *
 *   node scripts/deploy-devnet.mjs
 *
 * The point is the round trip. Anyone can send a create_config instruction; the
 * question this answers is whether the curve that lands on chain is the curve
 * that was simulated. So it builds a config, validates it, predicts what the
 * program will derive, deploys, reads the accounts back, and compares.
 *
 * Devnet only, and it spends devnet SOL. The keypair comes from the Solana CLI
 * config, so it is whatever `solana address` reports.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { baselineConfig, deriveLaunchMetrics, SOL, validateLaunchConfig } from '@preflight/config'
import { decodeLivePool, deployConfig, deployPool, fetchLivePool } from '@preflight/chain'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const RPC = process.env.SOLANA_DEVNET_RPC_URL ?? 'https://api.devnet.solana.com'

function loadCliKeypair() {
  // The CLI labels this "Keypair Path" in the full config and "Key Path" when
  // asked for the single value, so match either.
  const line = execFileSync('solana', ['config', 'get'], { encoding: 'utf8' })
    .split('\n')
    .find((candidate) => /Key(pair)? Path/i.test(candidate))
  const path = line?.slice(line.indexOf(':') + 1).trim()
  if (!path) {
    throw new Error('Could not read the keypair path from `solana config get`')
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))))
}

const step = (n, text) => console.log(`\n\x1b[38;5;141m${n}\x1b[0m ${text}`)
const ok = (text) => console.log(`  \x1b[32m✓\x1b[0m ${text}`)
const info = (k, v) => console.log(`    ${k.padEnd(22)} ${v}`)

const connection = new Connection(RPC, 'confirmed')
const payer = loadCliKeypair()

step('1.', 'Wallet')
const balance = await connection.getBalance(payer.publicKey)
info('address', payer.publicKey.toBase58())
info('balance', `${(balance / 1e9).toFixed(4)} SOL`)
if (balance < 0.05e9) throw new Error('Not enough devnet SOL. Run: solana airdrop 2 --url devnet')

step('2.', 'Build and check the curve')
const params = baselineConfig({ migrationQuoteThreshold: 5 })
const validation = validateLaunchConfig(params, SOL)
if (!validation.valid) {
  for (const finding of validation.findings)
    console.log(`    ${finding.severity}: ${finding.message}`)
  throw new Error('Refusing to deploy a configuration the program would reject')
}
const predicted = deriveLaunchMetrics(params, SOL)
ok('the validator accepts it')
info('opens at', `${predicted.initialPrice.toExponential(3)} SOL`)
info('graduates at', `${predicted.migrationPrice.toExponential(3)} SOL`)
info('migration sqrt price', predicted.migrationSqrtPrice.toString())
info('raises', `${predicted.migrationQuoteThreshold} SOL`)

step('3.', 'Deploy the config')
const { config, signature: configSig } = await deployConfig(connection, params, payer)
ok('config created')
info('address', config)
info('signature', configSig)

step('4.', 'Launch a pool against it')
const stamp = Date.now().toString(36).toUpperCase().slice(-4)
const {
  pool,
  baseMint,
  signature: poolSig,
} = await deployPool(
  connection,
  config,
  {
    name: `Preflight ${stamp}`,
    symbol: `PF${stamp}`,
    uri: 'https://example.invalid/preflight.json',
  },
  payer,
)
ok('pool created')
info('pool', pool)
info('base mint', baseMint)
info('signature', poolSig)

step('5.', 'Read it back and compare')
const live = await fetchLivePool(connection, pool)
const checks = [
  ['migration sqrt price', live.config.migrationSqrtPrice === predicted.migrationSqrtPrice],
  [
    'migration threshold',
    live.config.migrationQuoteThreshold === BigInt(params.migrationQuoteThreshold.toString()),
  ],
  ['start price', live.config.sqrtStartPrice === BigInt(params.sqrtStartPrice.toString())],
  ['pool opens on the curve', live.state.sqrtPrice === live.config.sqrtStartPrice],
  ['nothing traded yet', live.state.quoteReserve === 0n && !live.state.hasSwap],
]
let failed = 0
for (const [label, passed] of checks) {
  console.log(`  ${passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}`)
  if (!passed) failed++
}
if (failed)
  throw new Error(`${failed} check(s) failed: the deployed curve is not the simulated one`)

const record = {
  cluster: 'devnet',
  deployedAt: new Date().toISOString(),
  payer: payer.publicKey.toBase58(),
  config,
  pool,
  baseMint,
  signatures: { createConfig: configSig, createPool: poolSig },
  predicted: {
    initialPrice: predicted.initialPrice,
    migrationPrice: predicted.migrationPrice,
    migrationSqrtPrice: predicted.migrationSqrtPrice.toString(),
    migrationQuoteThreshold: predicted.migrationQuoteThreshold,
  },
}
writeFileSync(join(root, 'docs/devnet-deployment.json'), `${JSON.stringify(record, null, 2)}\n`)

console.log('\n\x1b[32mThe curve that was simulated is the curve that is on chain.\x1b[0m')
console.log(`  explorer  https://solscan.io/account/${pool}?cluster=devnet`)
console.log('  recorded  docs/devnet-deployment.json\n')
