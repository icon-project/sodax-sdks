// packages/dapp-kit/src/hooks/dex/useClaimRewards.ts
import type { ClLiquidityClaimRewardsAction, SpokeChainKey, TxHashPair } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useClaimRewards}. Generic over `K extends SpokeChainKey` (defaults
 * to the full union). Sophisticated callers can lock K at the hook call site to narrow the
 * `walletProvider` and `params.srcChainKey` types.
 */
export type UseClaimRewardsVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  ClLiquidityClaimRewardsAction<K, false>,
  'raw'
>;

/**
 * React hook for claiming accrued fees on a concentrated-liquidity position.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `TxHashPair` on success.
 */
export function useClaimRewards<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseClaimRewardsVars<K>> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseClaimRewardsVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseClaimRewardsVars<K>>({
    mutationKey: ['dex', 'claimRewards'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.dex.clService.claimRewards({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      // `usePositionInfo` keys by string tokenId — stringify the bigint to keep the structural match.
      queryClient.invalidateQueries({
        queryKey: ['dex', 'positionInfo', params.tokenId.toString(), params.poolKey],
      });
      queryClient.invalidateQueries({ queryKey: ['dex', 'poolBalances', params.srcChainKey, params.srcAddress] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
