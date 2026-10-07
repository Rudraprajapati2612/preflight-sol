import type { LiteSVM } from 'litesvm'
import type { Keypair, TransactionInstruction } from '@solana/web3.js'
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairFromBytes,
  createTransactionMessage,
  type Instruction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
} from '@solana/kit'

/**
 * Bridge between the two Solana JavaScript generations.
 *
 * The Meteora SDK is built on web3.js v1 (`PublicKey`, `TransactionInstruction`),
 * while LiteSVM 1.x speaks `@solana/kit` (web3.js v2) and takes a compiled,
 * signed transaction. This module converts the former into the latter. It is
 * the only place in the codebase that needs to know both dialects.
 */

function roleOf(meta: { isSigner: boolean; isWritable: boolean }): AccountRole {
  if (meta.isSigner) {
    return meta.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER
  }
  return meta.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY
}

export function toKitInstruction(instruction: TransactionInstruction): Instruction {
  return {
    programAddress: address(instruction.programId.toBase58()),
    accounts: instruction.keys.map((key) => ({
      address: address(key.pubkey.toBase58()),
      role: roleOf(key),
    })),
    data: new Uint8Array(instruction.data),
  }
}

/** Raised when the SVM rejects a transaction, carrying the program's own error. */
export class TransactionFailedError extends Error {
  constructor(readonly detail: string) {
    super(`transaction failed: ${detail}`)
    this.name = 'TransactionFailedError'
  }
}

/**
 * Sign a batch of web3.js v1 instructions and execute them against the SVM.
 *
 * `payer` signs and pays; `extraSigners` covers accounts the instructions
 * create (new mints, the config account, and so on).
 */
export async function sendInstructions(
  svm: LiteSVM,
  instructions: readonly TransactionInstruction[],
  payer: Keypair,
  extraSigners: readonly Keypair[] = [],
) {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(payer.publicKey.toBase58()), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 2n ** 53n - 1n },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions.map(toKitInstruction), m),
  )

  const keyPairs = await Promise.all(
    [payer, ...extraSigners].map((kp) => createKeyPairFromBytes(kp.secretKey)),
  )
  const signed = await signTransaction(keyPairs, compileTransaction(message))
  const result = svm.sendTransaction(signed)

  if (!('logs' in result)) {
    throw new TransactionFailedError(String(result))
  }
  return result
}
