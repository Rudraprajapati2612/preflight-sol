#!/usr/bin/env node
/**
 * Refresh (or verify) the on-chain program bytecode that the LiteSVM oracle runs.
 *
 *   node scripts/dump-programs.mjs --check   verify committed files against the manifest (no network)
 *   node scripts/dump-programs.mjs           re-dump from mainnet and rewrite the manifest hashes
 *
 * The .so files are committed deliberately: tests must run without network access.
 * Re-dumping is only needed when Meteora upgrades the program, which will show up
 * as a changed hash and should be reviewed, not silently accepted.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'packages/core/fixtures/programs')
const manifestPath = join(dir, 'manifest.json')

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const check = process.argv.includes('--check')

if (check) {
  let failed = 0
  for (const p of manifest.programs) {
    const file = join(dir, p.file)
    if (!existsSync(file)) {
      console.error(`MISSING  ${p.file}`)
      failed++
      continue
    }
    const actual = sha256(file)
    const ok = actual === p.sha256
    console.log(`${ok ? 'OK      ' : 'MISMATCH'} ${p.file}  ${actual.slice(0, 16)}`)
    if (!ok) failed++
  }
  if (failed) {
    console.error(`\n${failed} program file(s) do not match the manifest.`)
    process.exit(1)
  }
  console.log('\nAll program bytecode matches the manifest.')
  process.exit(0)
}

if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'))
const rpc = process.env.SOLANA_RPC_URL
if (!rpc) {
  console.error('SOLANA_RPC_URL is not set. Copy .env.example to .env and fill it in.')
  process.exit(1)
}

for (const p of manifest.programs) {
  const file = join(dir, p.file)
  process.stdout.write(`dumping ${p.name} (${p.programId}) ... `)
  execFileSync('solana', ['program', 'dump', '-u', rpc, p.programId, file], { stdio: 'pipe' })
  const actual = sha256(file)
  if (actual !== p.sha256) {
    console.log(`hash CHANGED\n  was ${p.sha256}\n  now ${actual}`)
    p.sha256 = actual
  } else {
    console.log('unchanged')
  }
}
manifest.dumpedAt = new Date().toISOString().slice(0, 10)
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log('\nmanifest.json updated.')
