import { http, type Address, type Hex, type PublicClient, type SignedAuthorization } from 'viem';
import { createBundlerClient, toSimple7702SmartAccount, type UserOperationReceipt } from 'viem/account-abstraction';
import { viewOnlyOwner } from './eoaStubAccount.js';
import type { UnsignedUserOp } from './userOpDto.js';

export type SubmitUserOpParams = {
  publicClient: PublicClient;
  /** Sender EOA (only used to resolve the Simple7702 EntryPoint; never signs here). */
  sender: Address;
  /** The exact unsigned UserOperation returned by `prepareUserOp` (rehydrated from the wire DTO). */
  userOp: UnsignedUserOp;
  userOpSignature: Hex;
  /** Hash of THIS op (`prepared.userOpHash`) — the idempotency key for recovering an already-broadcast op. */
  userOpHash: Hex;
  bundlerUrl: string;
  /** Signed EIP-7702 authorization — present iff delegation was required. */
  authorization?: SignedAuthorization;
};

/**
 * Broadcast the exact prepared UserOp with the external signature. The op is fully populated, so viem's internal
 * `prepareUserOperation` is a no-op (stays byte-identical, so the signature holds) and no paymaster is attached (no
 * re-fetch); the supplied `signature` makes viem skip signing, so the view-only owner only resolves the EntryPoint.
 *
 * Idempotent on `userOpHash`: a re-broadcast of an already-known / already-included op recovers that op's receipt
 * (`alreadyKnown: true`) instead of failing, so a client's network retry of a successful submit is a clean success.
 * This is safe and stateless — ERC-4337 EntryPoint nonce uniqueness means a replayed op cannot double-execute, and
 * the bundler (shared across API instances) is the dedup authority keyed on the caller-supplied `userOpHash`.
 * Returns the on-chain tx hash and whether the op was already known; a reverted op throws (a genuine, deterministic
 * failure), as does a rejection with no recoverable receipt for this exact hash.
 */
export async function submitUserOp(
  params: SubmitUserOpParams,
): Promise<{ srcChainTxHash: string; alreadyKnown: boolean }> {
  const { publicClient, sender, userOp, userOpSignature, userOpHash, bundlerUrl, authorization } = params;

  const account = await toSimple7702SmartAccount({ client: publicClient, owner: viewOnlyOwner(sender) });
  const bundlerClient = createBundlerClient({ account, client: publicClient, transport: http(bundlerUrl) });

  const broadcast = async (): Promise<{ receipt: UserOperationReceipt; alreadyKnown: boolean }> => {
    try {
      const hash = await bundlerClient.sendUserOperation({
        account,
        ...userOp,
        signature: userOpSignature,
        ...(authorization ? { authorization } : {}),
      });
      return { receipt: await bundlerClient.waitForUserOperationReceipt({ hash }), alreadyKnown: false };
    } catch (error) {
      const duplicate = classifyDuplicateSubmit(error);
      if (!duplicate) throw error; // a genuine bundler rejection stays a failure

      // Recover the receipt for THIS op's userOpHash — the idempotency key.
      const recovered =
        duplicate === 'known'
          ? // "already known": the exact op is accepted and pending in the mempool → wait for it to mine.
            await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash }).catch(() => null)
          : // "already included" / AA25 nonce-consumed: single lookup (getUserOperationReceipt throws when not
            // found → normalize to null). Don't wait: if a *different* op took the nonce, ours never mines.
            await bundlerClient.getUserOperationReceipt({ hash: userOpHash }).catch(() => null);

      // No receipt for THIS exact hash ⇒ the nonce was consumed by a different op ⇒ genuine failure.
      if (!recovered) throw error;
      return { receipt: recovered, alreadyKnown: true };
    }
  };

  const { receipt, alreadyKnown } = await broadcast();
  if (!receipt.success) {
    // Included but reverted — a deterministic failure, identical whether fresh or recovered.
    throw new Error('Gasless user operation reverted on-chain');
  }
  return { srcChainTxHash: receipt.receipt.transactionHash, alreadyKnown };
}

/**
 * Flatten an error and its `cause` chain into one lowercased string for marker matching (viem RPC errors bury the
 * bundler message in `.details` / `.shortMessage` / a nested `.cause`).
 */
function bundlerErrorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 10; depth++) {
    if (typeof current === 'string') {
      parts.push(current);
      break;
    }
    if (typeof current !== 'object') break;
    const e = current as { message?: unknown; shortMessage?: unknown; details?: unknown; cause?: unknown };
    for (const field of [e.message, e.shortMessage, e.details]) {
      if (typeof field === 'string') parts.push(field);
    }
    current = e.cause;
  }
  return parts.join(' | ').toLowerCase();
}

/**
 * Classify a bundler `sendUserOperation` rejection as a duplicate-submit signal — the basis for idempotent recovery.
 * Deliberately narrow: matches only the well-known "this op/nonce is already in flight" phrasings, never generic
 * failures ("failed", "rejected", "replacement underpriced"), so a genuine rejection still surfaces as an error.
 * This is the one place to extend as real bundler responses are observed.
 * - `'known'`    → the exact op is already in the bundler mempool ("already known") — pending, will mine.
 * - `'consumed'` → the op/nonce is already on-chain ("already included" / AA25 invalid account nonce).
 */
function classifyDuplicateSubmit(error: unknown): 'known' | 'consumed' | null {
  const text = bundlerErrorText(error);
  if (text.includes('already known')) return 'known';
  if (text.includes('already included') || text.includes('aa25')) return 'consumed';
  return null;
}
