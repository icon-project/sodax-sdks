// packages/dapp-kit/src/hooks/swap/useCancelSwap.ts
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { GetWalletProviderType, Intent, SpokeChainKey, TxHashPair } from '@sodax/sdk';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

type CancelIntentParams<K extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: K;
  walletProvider: GetWalletProviderType<K>;
  intent: Intent;
};

/**
 * React hook for cancelling an in-flight swap intent.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `TxHashPair` on success.
 */
export function useCancelSwap({
  mutationOptions,
}: MutationHookParams<TxHashPair, CancelIntentParams> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  CancelIntentParams
> {
  const { sodax } = useSodaxContext();

  return useSafeMutation<TxHashPair, Error, CancelIntentParams>({
    mutationKey: ['swap', 'cancel'],
    ...mutationOptions,
    mutationFn: async ({ srcChainKey, walletProvider, intent }) =>
      unwrapResult(await sodax.swaps.cancelIntent({ params: { srcChainKey, intent }, walletProvider })),
  });
}
