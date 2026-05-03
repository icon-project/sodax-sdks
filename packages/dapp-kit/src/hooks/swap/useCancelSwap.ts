import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { GetWalletProviderType, Result, SpokeChainKey, Intent, TxHashPair } from '@sodax/sdk';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';

type CancelIntentParams<K extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: K;
  walletProvider: GetWalletProviderType<K>;
  intent: Intent;
};

type CancelIntentResult = Result<TxHashPair>;

export function useCancelSwap(): UseMutationResult<CancelIntentResult, Error, CancelIntentParams> {
  const { sodax } = useSodaxContext();

  return useMutation<CancelIntentResult, Error, CancelIntentParams>({
    mutationFn: ({ srcChainKey, walletProvider, intent }) =>
      sodax.swaps.cancelIntent({ params: { srcChainKey, intent }, walletProvider }),
  });
}
