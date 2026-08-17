import type {
  EvmRawTransaction,
  GetWalletProviderType,
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

type ApprovalStep = 'allowance reset' | 'approve';

/**
 * `EvmRawTransactionReceipt.status` is documented as the JSON-RPC hex flag, but `EvmWalletProvider`
 * passes viem's `'reverted'` through unchanged, so both spellings reach here. A receipt without a
 * status is pre-Byzantium and inconclusive — not a revert.
 */
const isRevertedEvmReceiptStatus = (status: string | undefined): boolean => status === 'reverted' || status === '0x0';

/**
 * Broadcasts an approval plan in the only order that can work: `resetTx` mined first, then the
 * approve, which is not a valid state transition until the allowance has been zeroed on-chain.
 *
 * Not a pure helper like its neighbours here — it signs and sends through the caller's wallet
 * provider — but it is framework-free, and shared by the swaps and bridge approve-and-broadcast
 * hooks so the ordering is not re-derived per feature. `hookName` prefixes the errors.
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
  walletProvider: GetWalletProviderType<SpokeChainKey>;
  hookName: string;
}): Promise<ApprovalHashes> {
  // Coupled deliberately: returning before confirmation would hand the ordering hazard back to the caller.
  const sendAndWait = async (raw: RawTxReturnType, step: ApprovalStep): Promise<string> => {
    if (isHubChainKeyType(srcChainKey) || isEvmSpokeOnlyChainKeyType(srcChainKey)) {
      const evm = walletProvider as IEvmWalletProvider;
      const hash = await evm.sendTransaction(raw as EvmRawTransaction);
      const receipt = await evm.waitForTransactionReceipt(hash as Hex);
      // Mined is not succeeded: a revert here would let the approve go out over an unmoved allowance.
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

  // A throw aborts before the approve is sent: an unconfirmed reset leaves the allowance untouched,
  // so a retry re-plans and costs a single transaction.
  const resetTxHash = plan.resetTx === undefined ? undefined : await sendAndWait(plan.resetTx, 'allowance reset');
  const approveTxHash = await sendAndWait(plan.tx, 'approve');

  return resetTxHash === undefined ? { approveTxHash } : { resetTxHash, approveTxHash };
}
