'use client'

import { usePathname } from 'next/navigation'

/**
 * Two navigations, because there are two audiences.
 *
 * On the landing page the links are for somebody deciding whether to trust the
 * thing. Inside the app the bar is chrome: which surface you are on, and the
 * two facts worth knowing at all times — that the engine is running locally,
 * and which seed the run came from. Nothing here is a tab that goes nowhere.
 */

const TABS = [
  { href: '/simulate', label: 'Design + simulate' },
  { href: '/compare', label: 'Compare' },
  { href: '/inspect', label: 'Verify' },
]

export function Nav({ app = false, seed }: { app?: boolean; seed?: string }) {
  const pathname = usePathname()

  if (!app) {
    return (
      <nav className="nav">
        <div className="wrap inner">
          <a href="/">
            <img src="/logo.png" alt="Preflight" />
          </a>
          <span className="spacer" />
          <a className="link" href="/#how">
            How it works
          </a>
          <a className="link" href="/#proof">
            Correctness
          </a>
          <a className="link" href="/inspect">
            Replay a real pool
          </a>
          <a className="link" href="https://github.com/Pratikkale26/preflight">
            GitHub
          </a>
          <a className="btn btn-primary" href="/simulate">
            Open the workstation
          </a>
        </div>
      </nav>
    )
  }

  return (
    <nav className="nav app-nav">
      <div className="wrap inner">
        <a href="/">
          <img src="/logo.png" alt="Preflight" />
        </a>

        <div className="tabs">
          {TABS.map((tab) => (
            <a
              key={tab.href}
              href={tab.href}
              aria-current={pathname === tab.href ? 'page' : undefined}
            >
              {tab.label}
            </a>
          ))}
        </div>

        <span className="spacer" />

        <span className="status">
          <span className="dot" />
          Engine in-browser
        </span>
        {seed && <span className="status mono">seed {seed}</span>}
        <a className="link" href="https://github.com/Pratikkale26/preflight">
          GitHub
        </a>
      </div>
    </nav>
  )
}
