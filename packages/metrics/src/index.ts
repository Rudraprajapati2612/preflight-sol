/**
 * @preflight/metrics — turning a simulated launch into an answer.
 *
 * Amounts and counts stay exact in `bigint`; the conversion to a float happens
 * once, where the maths genuinely needs reals or where a human reads the
 * number. Accumulating in floats across thousands of trades would let rounding
 * compound into the very figures a launcher is comparing.
 */

export { buildReport } from './report.js'
export type { Candle, LaunchReport, ReportInput } from './report.js'
export { curveShape } from './curve-shape.js'
export type { CurvePoint as CurveShapePoint } from './curve-shape.js'
export { concentration, gini } from './concentration.js'
export type { Concentration } from './concentration.js'
export { priceFromSqrtPrice, ratio } from './price.js'
