// packages/dapp-kit/src/hooks/staking/useInstantUnstakeApprove.ts
import type { GetWalletProviderType, InstantUnstakeParams, SpokeChainKey, TxReturnType } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useInstantUnstakeApprove}. The `action` literal is injected by
 * the hook.
 */
export type UseInstantUnstakeApproveVars<K extends SpokeChainKey = SpokeChainKey> = {
  params: Omit<InstantUnstakeParams<K>, 'action'>;
  walletProvider: GetWalletProviderType<K>;
};

/**
 * React hook for approving xSODA spending on the instant-unstake action.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped tx return value on success.
 */
export function useInstantUnstakeApprove<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseInstantUnstakeApproveVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseInstantUnstakeApproveVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseInstantUnstakeApproveVars<K>>({
    mutationKey: ['staking', 'approve', 'instantUnstake'],
    ...mutationOptions,
    mutationFn: async ({ params, walletProvider }) =>
      unwrapResult(
        await sodax.staking.approve({
          params: { ...params, action: 'instantUnstake' },
          raw: false,
          walletProvider,
        }),
      ),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({
        queryKey: ['staking', 'allowance', vars.params.srcChainKey, 'instantUnstake'],
      });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
