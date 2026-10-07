import type { TransactionMetadata } from 'litesvm'

/**
 * Anchor's `emit_cpi!` discriminator. The DBC program's swap handler is
 * annotated `#[event_cpi]`, so its events are not written to the log stream:
 * they are emitted as a self-CPI whose instruction data is
 * `[8-byte CPI marker][8-byte event discriminator][borsh payload]`.
 *
 * That means events must be read from inner instructions, not from logs.
 */
const ANCHOR_EVENT_CPI_DISCRIMINATOR = 'e445a52e51cb9a1d'

/** Minimal shape of Anchor's event coder, to avoid depending on Anchor's types. */
export interface EventCoder {
  decode(base64: string): { name: string; data: unknown } | null
}

export interface DecodedEvent {
  readonly name: string
  readonly data: unknown
}

/**
 * Pull every Anchor event out of an executed transaction, in emission order.
 *
 * A DBC swap emits both `evtSwap` (the legacy shape) and `evtSwap2` (which
 * additionally carries `quoteReserveAmount` and `migrationThreshold`). Both are
 * returned; callers pick what they need.
 */
export function decodeAnchorEvents(meta: TransactionMetadata, coder: EventCoder): DecodedEvent[] {
  const events: DecodedEvent[] = []
  for (const group of meta.innerInstructions()) {
    for (const inner of group) {
      const data = Buffer.from(inner.instruction().data())
      if (data.length < 16) continue
      if (data.subarray(0, 8).toString('hex') !== ANCHOR_EVENT_CPI_DISCRIMINATOR) continue
      const decoded = coder.decode(data.subarray(8).toString('base64'))
      if (decoded) events.push({ name: decoded.name, data: decoded.data })
    }
  }
  return events
}

/** Find the first event with the given name, or undefined. */
export function findEvent(events: readonly DecodedEvent[], name: string): DecodedEvent | undefined {
  return events.find((event) => event.name === name)
}
