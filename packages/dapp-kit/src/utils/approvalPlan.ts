import type {
  EvmRawTransaction,
  Hex,
  IEvmWalletProvider,
  IStellarWalletProvider,
  RawTxReturnType,
  SpokeChainKey,
  StellarRawTransaction,
} from '@sodax/sdk';
import { isEvmSpokeOnlyChainKeyType, isHubChainKeyType, isStellarChainKeyType } from '@sodax/sdk';

/** Hashes of the transactions an approval plan broadcast, in the order they were sent. */
export type ApprovalHashes = {
  /** Present only when the source token needed its stale allowance cleared first. */
  readonly resetTxHash?: string;
  readonly approveTxHash: string;
};

/** The unsigned transactions a backend approve route hands back, in broadcast order. */
export type ApprovalPlan = {
  readonly tx: RawTxReturnType;
  readonly resetTx?: RawTxReturnType;
};

/** Names the transaction in an error, so a revert says which of the two steps failed. */
type ApprovalStep = 'allowance reset' | 'approve';

/**
 * `EvmRawTransactionReceipt.status` is documented as the JSON-RPC hex flag, but `EvmWalletProvider`
 * passes viem's `'reverted'` through unchanged, so both spellings reach here. A receipt without a
 * status is pre-Byzantium and inconclusive — not a revert.
 */
const isRevertedEvmReceiptStatus = (status: string | undefined): boolean => status === 'reverted' || status === '0x0';

/**
 * Broadcasts an approval plan in the only order that can work, waiting for each transaction to be
 * mined before the next is sent.
 *
 * A source token of the 2017 TetherToken lineage rejects an allowance change from one non-zero value
 * to another, so a backend approve route can hand back a **reset** transaction that must be mined
 * **before** the approve is even a valid state transition. Broadcasting them out of order, or without
 * waiting, spends the user's gas on a transaction that is certain to revert.
 *
 * Shared by the swaps and bridge approve-and-broadcast hooks: the two differ only in which route
 * produced the plan, never in how it must be sent, so keeping one implementation is what stops the
 * ordering from being re-derived (and mis-derived) per feature. `hookName` prefixes the errors so a
 * caller still learns which hook failed.
 *
 * Supports the chains a SODAX approve route can act on — the hub (Sonic), EVM spokes, and Stellar.
 * Every other chain reports its allowance as always sufficient, so approval never runs for it.
 */
export async function runApprovalPlan({
  plan,
  srcChainKey,
  walletProvider,
  hookName,
}: {
  plan: ApprovalPlan;
  srcChainKey: SpokeChainKey;
  walletProvider: unknown;
  hookName: string;
}): Promise<ApprovalHashes> {
  // Broadcast and wait as one step: the next transaction is only valid once this one has landed, so
  // returning before confirmation would hand the caller back the same ordering hazard.
  const sendAndWait = async (raw: RawTxReturnType, step: ApprovalStep): Promise<string> => {
    if (isHubChainKeyType(srcChainKey) || isEvmSpokeOnlyChainKeyType(srcChainKey)) {
      const evm = walletProvider as IEvmWalletProvider;
      const hash = await evm.sendTransaction(raw as EvmRawTransaction);
      const receipt = await evm.waitForTransactionReceipt(hash as Hex);
      // Mined is not the same as succeeded: a paused or blacklisted token reverts on-chain, and
      // waiting alone would let the next transaction go out over an allowance that never moved.
      if (isRevertedEvmReceiptStatus(receipt.status)) {
        throw new Error(`[${hookName}] the ${step} transaction ${hash} reverted on chain.`);
      }
      return hash;
    }

    if (isStellarChainKeyType(srcChainKey)) {
      const stellar = walletProvider as IStellarWalletProvider;
      // Optional on the interface — not every Stellar wallet implements it.
      if (!stellar.signAndSendTransaction) {
        throw new Error(`[${hookName}] this Stellar wallet provider does not implement signAndSendTransaction.`);
      }
      const hash = await stellar.signAndSendTransaction(raw as StellarRawTransaction);
      const receipt = await stellar.waitForTransactionReceipt(hash);
      if (receipt.successful === false) {
        throw new Error(`[${hookName}] the ${step} transaction ${hash} failed on chain.`);
      }
      return hash;
    }

    throw new Error(
      `[${hookName}] ${srcChainKey} cannot be approved — SODAX approve routes support the hub (Sonic), EVM spokes, and Stellar.`,
    );
  };

  // A throw here aborts before the approve is sent, which is the point: an unconfirmed reset leaves
  // the allowance untouched, so a retry re-plans and costs a single transaction.
  const resetTxHash = plan.resetTx === undefined ? undefined : await sendAndWait(plan.resetTx, 'allowance reset');
  const approveTxHash = await sendAndWait(plan.tx, 'approve');

  return resetTxHash === undefined ? { approveTxHash } : { resetTxHash, approveTxHash };
}
