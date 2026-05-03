import { useSodaxContext } from '../shared/useSodaxContext.js';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { CreateLimitOrderParams, SwapResponse } from '@sodax/sdk';
import type { GetWalletProviderType, Result, SpokeChainKey } from '@sodax/sdk';

type CreateLimitOrderResult = Result<SwapResponse>;

export function useCreateLimitOrder<K extends SpokeChainKey>(
  srcChainKey: K | undefined,
  walletProvider: GetWalletProviderType<K> | undefined,
): UseMutationResult<CreateLimitOrderResult, Error, CreateLimitOrderParams> {
  const { sodax } = useSodaxContext();

  return useMutation<CreateLimitOrderResult, Error, CreateLimitOrderParams>({
    mutationFn: async (params: CreateLimitOrderParams) => {
      if (!srcChainKey || !walletProvider) {
        throw new Error('Source chain key and wallet provider are required');
      }
      return sodax.swaps.createLimitOrder({ params, raw: false, walletProvider });
    },
  });
}
