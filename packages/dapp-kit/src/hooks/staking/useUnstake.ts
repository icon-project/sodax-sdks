// packages/dapp-kit/src/hooks/staking/useUnstake.ts
import type { SpokeChainKey, TxHashPair, UnstakeAction } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseUnstakeVars<K extends SpokeChainKey = SpokeChainKey> = Omit<UnstakeAction<K, false>, 'raw'>;

/**
 * React hook for initiating an SODA unstake.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `TxHashPair` on success.
 */
export function useUnstake<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseUnstakeVars<K>> = {}): SafeUseMutationResult<TxHashPair, Error, UseUnstakeVars<K>> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseUnstakeVars<K>>({
    mutationKey: ['staking', 'unstake'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.staking.unstake({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({ queryKey: ['staking', 'info', params.srcChainKey, params.srcAddress] });
      // Scope to (srcChainKey, srcAddress) so a user's unstake doesn't refetch every other user's
      // staking data. Matches `useUnstakingInfo` / `useUnstakingInfoWithPenalty` query keys.
      queryClient.invalidateQueries({ queryKey: ['staking', 'unstakingInfo', params.srcChainKey, params.srcAddress] });
      queryClient.invalidateQueries({
        queryKey: ['staking', 'unstakingInfoWithPenalty', params.srcChainKey, params.srcAddress],
      });
      queryClient.invalidateQueries({ queryKey: ['staking', 'allowance', params.srcChainKey, 'unstake'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
