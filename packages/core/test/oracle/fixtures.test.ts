import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  buildBaselineFixture,
  buildDynamicFeeFixture,
  buildExactOutFixture,
  buildFeeDecayFixture,
  buildOutputFeeFixture,
  dbcProgramSha256,
  type OracleFixture,
} from '../../src/oracle/fixtures.js'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/oracle')
const pathFor = (name: string): string => join(fixtureDir, `${name}.json`)

/** Every recording the oracle produces, checked the same way. */
const RECORDINGS = [
  { file: 'baseline', build: buildBaselineFixture },
  { file: 'dynamic-fee', build: buildDynamicFeeFixture },
  { file: 'output-fee', build: buildOutputFeeFixture },
  { file: 'exact-out', build: buildExactOutFixture },
  { file: 'fee-decay', build: buildFeeDecayFixture },
] as const

/**
 * The recorded fixture is regenerated on every run and compared against the
 * committed copy. That makes this test do double duty: it proves the oracle is
 * deterministic, and it makes any change in the program's behaviour show up as
 * a diff rather than as a silently updated expectation.
 *
 * Set UPDATE_FIXTURES=1 to accept a change deliberately.
 */
describe.each(RECORDINGS)('oracle fixture: $file', ({ file, build }) => {
  const fixturePath = pathFor(file)

  it('is deterministic and matches the committed recording', async () => {
    const generated = await build()
    const accepting = process.env['UPDATE_FIXTURES'] === '1'

    if (accepting) {
      mkdirSync(dirname(fixturePath), { recursive: true })
      writeFileSync(fixturePath, `${JSON.stringify(generated, null, 2)}\n`)
    } else if (!existsSync(fixturePath)) {
      // Writing it here would make the test assert against whatever the program
      // just produced, which always passes and proves nothing.
      throw new Error(
        `Missing recording at ${fixturePath}. It is committed and should not be ` +
          `absent. Re-create it deliberately with UPDATE_FIXTURES=1.`,
      )
    }

    const committed = JSON.parse(readFileSync(fixturePath, 'utf8')) as OracleFixture

    // Check the cheap, legible thing before the deep comparison, so a stale
    // recording reports itself instead of printing a 30KB diff.
    expect(
      committed.programSha256,
      'recording was made against different bytecode; regenerate with UPDATE_FIXTURES=1',
    ).toBe(dbcProgramSha256())

    expect(generated).toEqual(committed)
  })

  it('records a launch that walks the curve up and completes it', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as OracleFixture

    // Structural rather than a fixed count, so adding a trade to a recording
    // does not fail a test that is really about the shape of a launch.
    expect(fixture.swaps.length).toBeGreaterThanOrEqual(2)
    const prices = fixture.swaps.map((s) =>
      BigInt((s.event as { swapResult: { nextSqrtPrice: string } }).swapResult.nextSqrtPrice),
    )
    // Every buy moves the price upward. Not strictly: a trade can be too small
    // to change the square-root price at this precision, and that is a real
    // case worth recording rather than one to design out of the fixture.
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]!).toBeGreaterThanOrEqual(prices[i - 1]!)
    }
    expect(prices.at(-1)!).toBeGreaterThan(prices[0]!)

    const last = fixture.swaps.at(-1)!
    if (last.kind !== 'partialFill') return // a recording that ends another way
    const result = last.event as {
      swapResult: { amountLeft: string; excludedFeeInputAmount: string }
      quoteReserveAmount: string
      migrationThreshold: string
    }

    // The final swap was larger than the curve could absorb, so the program
    // must have stopped at the migration price and returned the remainder.
    expect(BigInt(result.swapResult.amountLeft)).toBeGreaterThan(0n)
    // And the quote reserve must have reached the migration threshold.
    expect(BigInt(result.quoteReserveAmount)).toBeGreaterThanOrEqual(
      BigInt(result.migrationThreshold),
    )
  })
})
