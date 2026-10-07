/**
 * Where you are in the work.
 *
 * Configuring, stress testing and comparing all happen on the simulator, so
 * they are shown as phases of one screen rather than as links that would take
 * you nowhere. Validating and deploying genuinely leave: one to mainnet data,
 * one to a command line. Nothing here is a button that does not do anything.
 */

const PHASES = ['Configure', 'Stress test', 'Compare'] as const

/** Only Compare is a separate screen; the other two are this page. */
const HREF: Partial<Record<(typeof PHASES)[number], string>> = { Compare: '/compare' }

export function Workflow({ phase }: { phase: (typeof PHASES)[number] }) {
  return (
    <div className="flow">
      <ol>
        {PHASES.map((name, index) => (
          <li key={name} aria-current={name === phase ? 'step' : undefined}>
            <span className="n">{index + 1}</span>
            {HREF[name] ? <a href={HREF[name]}>{name}</a> : name}
          </li>
        ))}
      </ol>
      <span className="flow-rule" />
      <a className="flow-out" href="/inspect">
        Validate against mainnet
      </a>
      <code className="flow-cmd" title="Deploys a baseline curve to devnet and reads it back">
        pnpm deploy:devnet
      </code>
    </div>
  )
}
