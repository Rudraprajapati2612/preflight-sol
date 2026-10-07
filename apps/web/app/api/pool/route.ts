import { fetchLivePool, fetchSwapHistory, openingState, replayLaunch } from '@preflight/chain'
import { priceFromSqrtPrice } from '@preflight/metrics'
import { Connection, PublicKey } from '@solana/web3.js'
import { NextResponse } from 'next/server'

/**
 * Load a live DBC pool and replay what has happened to it.
 *
 * Server-side because the RPC endpoint carries a key, and because replaying a
 * busy launch means fetching hundreds of transactions — work that belongs
 * nowhere near a browser.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Enough to be convincing without making someone wait a minute for a page. */
const MAX_SIGNATURES = 120

/**
 * The two quote assets worth naming. Everything else is shown by its mint,
 * because guessing a ticker from an address is how a page ends up lying.
 */
const KNOWN_SYMBOLS: Record<string, string> = {
  So11111111111111111111111111111111111111112: 'SOL',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
}

/**
 * Read a mint's decimals off the account.
 *
 * DBC accepts any SPL mint as quote, so assuming nine of them prices a
 * USDC-quoted pool a thousand times wrong while still looking like a number.
 * Decimals sit at offset 44 of the mint layout, which Token and Token-2022
 * share for the first 82 bytes.
 */
async function mintDecimals(connection: Connection, mints: string[]): Promise<number[]> {
  const accounts = await connection.getMultipleAccountsInfo(mints.map((m) => new PublicKey(m)))
  return accounts.map((account, index) => {
    const decimals = account?.data[44]
    if (decimals === undefined) throw new Error(`Could not read decimals for mint ${mints[index]}.`)
    return decimals
  })
}

function endpoint(): string | null {
  if (process.env['SOLANA_RPC_URL']) return process.env['SOLANA_RPC_URL']
  const key = process.env['HELIUS_API_KEY']
  return key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : null
}

export async function GET(request: Request): Promise<NextResponse> {
  const address = new URL(request.url).searchParams.get('address')?.trim()
  if (!address) {
    return NextResponse.json({ error: 'No pool address given.' }, { status: 400 })
  }

  const rpc = endpoint()
  if (!rpc) {
    return NextResponse.json(
      { error: 'This deployment has no RPC endpoint configured, so it cannot read mainnet.' },
      { status: 503 },
    )
  }

  try {
    const connection = new Connection(rpc, 'confirmed')
    const live = await fetchLivePool(connection, address)

    const swaps = await fetchSwapHistory(connection, address, { limit: MAX_SIGNATURES })
    const report = replayLaunch(address, live.config, swaps)

    const [baseDecimals, quoteDecimals] = await mintDecimals(connection, [
      live.meta.baseMint,
      live.meta.quoteMint,
    ])
    const price = (sqrtPrice: bigint) =>
      priceFromSqrtPrice(sqrtPrice, baseDecimals!, quoteDecimals!)

    return NextResponse.json({
      address,
      meta: {
        baseMint: live.meta.baseMint,
        quoteMint: live.meta.quoteMint,
        creator: live.meta.creator,
        isMigrated: live.meta.isMigrated,
      },
      quote: {
        mint: live.meta.quoteMint,
        decimals: quoteDecimals,
        symbol: KNOWN_SYMBOLS[live.meta.quoteMint] ?? `${live.meta.quoteMint.slice(0, 4)}\u2026`,
      },
      state: {
        price: price(live.state.sqrtPrice),
        quoteRaised: live.state.quoteReserve.toString(),
        migrationThreshold: live.config.migrationQuoteThreshold.toString(),
        progress:
          live.config.migrationQuoteThreshold > 0n
            ? Number((live.state.quoteReserve * 10_000n) / live.config.migrationQuoteThreshold) /
              10_000
            : 0,
        feesToProtocol: (live.state.protocolQuoteFee + live.state.protocolBaseFee).toString(),
        feesToPartner: (live.state.partnerQuoteFee + live.state.partnerBaseFee).toString(),
        feesToCreator: (live.state.creatorQuoteFee + live.state.creatorBaseFee).toString(),
        graduated: live.state.quoteReserve >= live.config.migrationQuoteThreshold,
      },
      curve: {
        openingPrice: price(live.config.sqrtStartPrice),
        migrationPrice: price(live.config.migrationSqrtPrice),
        startedWith: openingState(live.config, live.state.activationPoint).baseReserve.toString(),
      },
      replay: {
        swaps: report.swapsReplayed,
        fieldsCompared: report.fieldsCompared,
        divergences: report.divergences.length,
        exact: report.exact,
        // Kept short: a reader wants to know whether anything disagreed, and
        // if so which field of which trade, not a dump of every one.
        firstDivergences: report.divergences.slice(0, 5),
        unsupported: report.unsupported,
        capped: swaps.length >= MAX_SIGNATURES,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    )
  }
}
