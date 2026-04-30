import type { TxReturnType, WithdrawHubAssetAction } from '@sodax/sdk';
import type { Result, SpokeChainKey } from '@sodax/types';
import { useMutation, type UseMutationResult, useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';

/**
 * Mutation variables for {@link useWithdrawHubAsset}. Generic over `K extends SpokeChainKey`
 * (defaults to the full union). Sophisticated callers can lock K at the hook call site to narrow
 * the `walletProvider` and `params.srcChainKey` types.
 */
export type UseWithdrawHubAssetVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  WithdrawHubAssetAction<K, false>,
  'raw'
>;

type WithdrawHubAssetResult<K extends SpokeChainKey> = Result<TxReturnType<K, false>>;

/**
 * React hook for withdrawing a hub-side asset back to the user's spoke chain wallet. Pure
 * mutation: returns the SDK `Result<T>` as-is; callers branch on `data?.ok`.
 */
export function useWithdrawHubAsset<K extends SpokeChainKey = SpokeChainKey>(): UseMutationResult<
  WithdrawHubAssetResult<K>,
  Error,
  UseWithdrawHubAssetVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useMutation<WithdrawHubAssetResult<K>, Error, UseWithdrawHubAssetVars<K>>({
    mutationFn: async vars => {
      return sodax.recovery.withdrawHubAsset<K, false>({ ...vars, raw: false });
    },
    onSuccess: (_data, { params }) => {
      queryClient.invalidateQueries({
        queryKey: ['recovery', 'hubAssetBalances', params.srcChainKey, params.srcAddress],
      });
      queryClient.invalidateQueries({ queryKey: ['xBalances', params.srcChainKey] });
    },
  });
}
