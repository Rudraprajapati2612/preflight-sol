import type { LiteSVM } from 'litesvm'
import { address } from '@solana/kit'
import { type AccountInfo, type Connection, PublicKey } from '@solana/web3.js'

/**
 * A `Connection` backed by an in-memory LiteSVM instance.
 *
 * The Meteora SDK builds its transactions against a `Connection`, and we want
 * to drive the SDK — not a reimplementation of it — against the real program.
 * Rather than stubbing out the SDK, we give it something that looks like an RPC
 * endpoint and actually reads from the SVM.
 *
 * Only the handful of methods the SDK and Anchor actually reach for are
 * implemented. Anything else throws loudly rather than returning a plausible
 * lie, so a new SDK code path shows up as a clear error instead of a subtly
 * wrong fixture.
 */
export function createSvmConnection(svm: LiteSVM): Connection {
  const readAccount = (pubkey: PublicKey): AccountInfo<Buffer> | null => {
    const account = svm.getAccount(address(pubkey.toBase58()))
    // LiteSVM reports a missing account as `{ exists: false }`, not as null.
    if (!account?.exists) return null
    return {
      executable: account.executable,
      owner: new PublicKey(account.programAddress.toString()),
      lamports: Number(account.lamports),
      data: Buffer.from(account.data),
      rentEpoch: 0,
    }
  }

  const connection = {
    commitment: 'confirmed',
    rpcEndpoint: 'litesvm://in-memory',

    getAccountInfo: (pubkey: PublicKey) => Promise.resolve(readAccount(pubkey)),

    getAccountInfoAndContext: (pubkey: PublicKey) =>
      Promise.resolve({
        context: { slot: Number(svm.getClock().slot) },
        value: readAccount(pubkey),
      }),

    getMultipleAccountsInfo: (pubkeys: PublicKey[]) => Promise.resolve(pubkeys.map(readAccount)),

    getBalance: (pubkey: PublicKey) =>
      Promise.resolve(Number(svm.getBalance(address(pubkey.toBase58())) ?? 0n)),

    getMinimumBalanceForRentExemption: (dataLength: number) =>
      Promise.resolve(Number(svm.minimumBalanceForRentExemption(BigInt(dataLength)))),

    getLatestBlockhash: () =>
      Promise.resolve({
        blockhash: svm.latestBlockhash(),
        lastValidBlockHeight: Number.MAX_SAFE_INTEGER,
      }),

    getSlot: () => Promise.resolve(Number(svm.getClock().slot)),

    getBlockTime: () => Promise.resolve(Number(svm.getClock().unixTimestamp)),
  }

  // The real `Connection` class has a large surface we deliberately do not
  // implement; the proxy turns any unimplemented access into an explicit error.
  return new Proxy(connection, {
    get(target, property, receiver) {
      if (property in target) return Reflect.get(target, property, receiver)
      if (typeof property === 'symbol') return undefined
      return () => {
        throw new Error(
          `createSvmConnection: Connection.${property} is not implemented. ` +
            `Add it to svm-connection.ts if the SDK now needs it.`,
        )
      }
    },
  }) as unknown as Connection
}
