import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { GetWalletProviderType, Result, SpokeChainKey, Intent, TxHashPair } from '@sodax/sdk';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';

type CancelLimitOrderParams<K extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: K;
  walletProvider: GetWalletProviderType<K>;
  intent: Intent;
  timeout?: number;
};

type CancelLimitOrderResult = Result<TxHashPair>;

export function useCancelLimitOrder(): UseMutationResult<CancelLimitOrderResult, Error, CancelLimitOrderParams> {
  const { sodax } = useSodaxContext();

  return useMutation<CancelLimitOrderResult, Error, CancelLimitOrderParams>({
    mutationFn: ({ srcChainKey, walletProvider, intent, timeout }) =>
      sodax.swaps.cancelLimitOrder({ params: { srcChainKey, intent }, walletProvider, timeout }),
  });
}
