'use client'

import { useState } from 'react'

/**
 * The bridge out of the simulator.
 *
 * A curve that survives a stress test is still only a screen until it becomes
 * a `create_config` instruction. This hands over the exact `buildCurve`
 * argument that produced everything above — not a summary of it, the argument
 * itself — so what gets deployed is what was simulated.
 *
 * It stops at the text. Deploying from the browser would mean a wallet
 * connection and a signing path that does not exist yet, and a button that
 * looked like it deployed would be worse than none.
 */
export function ExportConfig({ args }: { args: Record<string, unknown> }) {
  const [copied, setCopied] = useState<string | null>(null)

  const source = `import { baselineConfig } from '@preflight/config'

const params = baselineConfig(${stringify(args, 2)})`

  const copy = (what: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(what)
        setTimeout(() => setCopied(null), 1600)
      },
      () => setCopied('failed'),
    )
  }

  return (
    <>
      <p className="prose">
        The argument that built the curve above. Passing it to <code>baselineConfig</code> and then
        to <code>create_config</code> deploys this launch and not a retyped approximation of it.
      </p>

      <pre className="code-block">{source}</pre>

      <div className="export-actions">
        <button className="btn btn-primary" onClick={() => copy('config', source)}>
          {copied === 'config' ? 'Copied' : 'Copy the configuration'}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => copy('json', stringify(args, 2))}
          title="The same values as plain JSON"
        >
          {copied === 'json' ? 'Copied' : 'Copy as JSON'}
        </button>
      </div>

      <p className="prose" style={{ marginTop: 14 }}>
        <code>pnpm deploy:devnet</code> deploys a curve to devnet and reads the accounts back to
        confirm the program derived what was predicted. It builds its own baseline today; pointing
        it at an exported file is the next step, and there is no wallet in the browser, so nothing
        here can sign.
      </p>
    </>
  )
}

/**
 * JSON, but readable as source.
 *
 * `JSON.stringify` quotes every key and would turn the argument into something
 * that has to be edited before it compiles. Keys that are valid identifiers
 * are left bare, and bigints are printed rather than throwing.
 */
function stringify(value: unknown, indent: number, depth = 1): string {
  const pad = ' '.repeat(indent * depth)
  const closing = ' '.repeat(indent * (depth - 1))

  if (typeof value === 'bigint') return `${value}n`
  if (typeof value !== 'object' || value === null) return JSON.stringify(value) ?? 'null'

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map((item) => `${pad}${stringify(item, indent, depth + 1)}`)
    return `[\n${items.join(',\n')}\n${closing}]`
  }

  const entries = Object.entries(value)
  if (entries.length === 0) return '{}'
  const lines = entries.map(
    ([key, item]) =>
      `${pad}${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${stringify(item, indent, depth + 1)}`,
  )
  return `{\n${lines.join(',\n')}\n${closing}}`
}
