import type {
  ApproveResponseV2,
  CreateIntentParamsV2,
  EvmRawTransaction,
  GetWalletProviderType,
  Hex,
  IEvmWalletProvider,
  IStellarWalletProvider,
  RawTxReturnType,
  RequestOverrideConfig,
  SpokeChainKey,
  StellarRawTransaction,
} from '@sodax/sdk';
import { isEvmSpokeOnlyChainKeyType, isHubChainKeyType, isStellarChainKeyType } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/** Hashes of the transactions this hook broadcast, in the order they were sent. */
export type SwapsApiApprovalHashes = {
  /** Present only when the source token needed its stale allowance cleared first. */
  readonly resetTxHash?: string;
  readonly approveTxHash: string;
};

export type UseSwapsApiApproveAndBroadcastVars<K extends SpokeChainKey = SpokeChainKey> = {
  body: CreateIntentParamsV2;
  walletProvider: GetWalletProviderType<K>;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook that runs the whole swaps-API approval: asks the API for the transactions, then signs,
 * broadcasts, and waits for each one.
 *
 * Prefer this over {@link useSwapsApiApprove}, which returns the unsigned `{ tx, resetTx? }` and
 * leaves the rest to you. A source token of the 2017 TetherToken lineage rejects an allowance change
 * from one non-zero value to another, so the API can hand back a **reset** transaction that must be
 * mined **before** the approve is even a valid state transition. Broadcasting them out of order, or
 * without waiting, spends the user's gas on a transaction that is certain to revert — and that is
 * ordering the package should own rather than every integration re-deriving it.
 *
 * Because confirmation now happens inside the hook, it can invalidate `['swapsApi','allowance']`
 * itself; callers of `useSwapsApiApprove` have to refetch by hand.
 *
 * Supports the chains the swaps API can approve on — the hub (Sonic), EVM spokes, and Stellar.
 * Every other chain reports its allowance as always sufficient, so approval never runs for it.
 *
 * @example
 * const { mutateAsyncSafe: approve } = useSwapsApiApproveAndBroadcast();
 * const result = await approve({ body: createIntentParams, walletProvider });
 * if (!result.ok) return;
 * const { resetTxHash, approveTxHash } = result.value;   // resetTxHash only on a guarded token
 */
export const useSwapsApiApproveAndBroadcast = <K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<SwapsApiApprovalHashes, UseSwapsApiApproveAndBroadcastVars<K>> = {}): SafeUseMutationResult<
  SwapsApiApprovalHashes,
  Error,
  UseSwapsApiApproveAndBroadcastVars<K>
> => {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<SwapsApiApprovalHashes, Error, UseSwapsApiApproveAndBroadcastVars<K>>({
    mutationKey: ['swapsApi', 'approveAndBroadcast'],
    ...mutationOptions,
    mutationFn: async ({ body, walletProvider, apiConfig }): Promise<SwapsApiApprovalHashes> => {
      const { tx, resetTx }: ApproveResponseV2 = unwrapResult(await sodax.api.swaps.approve(body, apiConfig));
      const srcChainKey = body.srcChainKey as SpokeChainKey;

      // Broadcast and wait as one step: the next transaction is only valid once this one has landed,
      // so returning before confirmation would hand the caller back the same ordering hazard.
      const sendAndWait = async (raw: RawTxReturnType): Promise<string> => {
        if (isHubChainKeyType(srcChainKey) || isEvmSpokeOnlyChainKeyType(srcChainKey)) {
          const evm = walletProvider as IEvmWalletProvider;
          const hash = await evm.sendTransaction(raw as EvmRawTransaction);
          await evm.waitForTransactionReceipt(hash as Hex);
          return hash;
        }

        if (isStellarChainKeyType(srcChainKey)) {
          const stellar = walletProvider as IStellarWalletProvider;
          // Optional on the interface — not every Stellar wallet implements it.
          if (!stellar.signAndSendTransaction) {
            throw new Error(
              '[useSwapsApiApproveAndBroadcast] this Stellar wallet provider does not implement signAndSendTransaction.',
            );
          }
          const hash = await stellar.signAndSendTransaction(raw as StellarRawTransaction);
          await stellar.waitForTransactionReceipt(hash);
          return hash;
        }

        throw new Error(
          `[useSwapsApiApproveAndBroadcast] ${srcChainKey} cannot be approved — the swaps API supports the hub (Sonic), EVM spokes, and Stellar.`,
        );
      };

      // A throw here aborts before the approve is sent, which is the point: an unconfirmed reset
      // leaves the allowance untouched, so a retry re-plans and costs a single transaction.
      const resetTxHash = resetTx === undefined ? undefined : await sendAndWait(resetTx);
      const approveTxHash = await sendAndWait(tx);

      return resetTxHash === undefined ? { approveTxHash } : { resetTxHash, approveTxHash };
    },
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['swapsApi', 'allowance'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
};
