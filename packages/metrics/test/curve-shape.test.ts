import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodeConfig } from '@preflight/core'
import type { OracleFixture } from '@preflight/core/oracle'
import { describe, expect, it } from 'vitest'

import { curveShape } from '../src/curve-shape.js'
import { priceFromSqrtPrice } from '../src/price.js'

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../core/fixtures/oracle/baseline.json'),
    'utf8',
  ),
) as OracleFixture
const config = decodeConfig(fixture.configAccount)

describe('curveShape', () => {
  const shape = curveShape(config, 6, 9)

  it('starts where the config says the curve starts', () => {
    expect(shape.length).toBeGreaterThan(10)
    expect(shape[0]!.quoteRaised).toBe(0n)
    expect(shape[0]!.progress).toBe(0)
  })

  it('rises monotonically, because a bonding curve does', () => {
    for (let i = 1; i < shape.length; i++) {
      expect(shape[i]!.price).toBeGreaterThanOrEqual(shape[i - 1]!.price)
      expect(shape[i]!.quoteRaised).toBeGreaterThanOrEqual(shape[i - 1]!.quoteRaised)
      expect(shape[i]!.baseSold).toBeGreaterThanOrEqual(shape[i - 1]!.baseSold)
    }
  })

  it('ends at the migration threshold the program will enforce', () => {
    const raised = shape.at(-1)!.quoteRaised
    const threshold = config.migrationQuoteThreshold
    // Sampling makes this approximate; a percent is well inside what a chart
    // shows, and being far off would mean the curve is being drawn wrong.
    const drift = Number(((raised - threshold) * 1000n) / threshold) / 1000
    expect(Math.abs(drift)).toBeLessThan(0.01)
  })

  it('ends at the migration price, not at the last curve point', () => {
    expect(shape.at(-1)!.price).toBeCloseTo(priceFromSqrtPrice(config.migrationSqrtPrice, 6, 9), 12)
  })

  it('has nothing to draw for a curve with no segments', () => {
    expect(curveShape({ ...config, curve: [] }, 6, 9)).toEqual([])
  })
})
