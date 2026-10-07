import type { Metadata } from 'next'
import { Instrument_Sans, JetBrains_Mono } from 'next/font/google'

import './globals.css'

/*
 * Self-hosted at build time by next/font, so there is no request to a font CDN
 * at page load and no flash of fallback text.
 *
 * Instrument Sans rather than Inter: narrower, and it holds its shape at the
 * 11–12px this interface spends most of its time at.
 */
const sans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Preflight — simulate a Meteora bonding curve before it launches',
  description:
    'Configure a Meteora Dynamic Bonding Curve, run snipers and whales against it, and see who ends up holding the token — before real money is on the line.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
