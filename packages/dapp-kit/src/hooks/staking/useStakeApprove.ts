// packages/dapp-kit/src/hooks/staking/useStakeApprove.ts
import type { GetWalletProviderType, SpokeChainKey, StakeParams, TxReturnType } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useStakeApprove}. The `action` literal is injected by the hook —
 * callers pass the stake-specific fields only.
 */
export type UseStakeApproveVars<K extends SpokeChainKey = SpokeChainKey> = {
  params: Omit<StakeParams<K>, 'action'>;
  walletProvider: GetWalletProviderType<K>;
};

/**
 * React hook for approving SODA spending on the stake action.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped tx return value on success.
 */
export function useStakeApprove<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseStakeApproveVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseStakeApproveVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseStakeApproveVars<K>>({
    mutationKey: ['staking', 'approve', 'stake'],
    ...mutationOptions,
    mutationFn: async ({ params, walletProvider }) =>
      unwrapResult(
        await sodax.staking.approve({
          params: { ...params, action: 'stake' },
          raw: false,
          walletProvider,
        }),
      ),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['staking', 'allowance', vars.params.srcChainKey, 'stake'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
