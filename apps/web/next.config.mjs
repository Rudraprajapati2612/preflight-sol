import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Read the workspace-root .env.
 *
 * Next loads .env from its own directory, which in a monorepo is apps/web —
 * not where the file lives. The scripts and the tests read the root one, so
 * without this the web app is the only part of the repository that cannot see
 * the RPC endpoint, and /inspect reports that the deployment has none.
 *
 * Anything already in the environment wins, so a hosted deployment's own
 * configuration is never overwritten, and a missing file is not an error:
 * on Vercel there is no .env and the variables arrive from the dashboard.
 */
function loadWorkspaceEnv() {
  const path = join(dirname(fileURLToPath(import.meta.url)), '../../.env')

  let contents
  try {
    contents = readFileSync(path, 'utf8')
  } catch {
    return
  }

  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue

    const separator = trimmed.indexOf('=')
    if (separator === -1) continue

    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    // ${OTHER} references, so SOLANA_RPC_URL can be written in terms of the
    // API key the way .env.example writes it.
    value = value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] ?? '')

    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadWorkspaceEnv()

/** @type {import('next').NextConfig} */
export default {
  // The workspace packages ship TypeScript source rather than build output, so
  // Next compiles them alongside the app.
  transpilePackages: [
    '@preflight/core',
    '@preflight/config',
    '@preflight/agents',
    '@preflight/metrics',
    '@preflight/chain',
  ],
  webpack(config) {
    // Those packages are Node ESM, so their internal imports carry a .js
    // extension even though the files on disk are .ts. Node resolves that;
    // webpack needs telling.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    }
    return config
  },
}
