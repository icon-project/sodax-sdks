// packages/dapp-kit/src/hooks/staking/useUnstakeApprove.ts
import type { GetWalletProviderType, SpokeChainKey, TxReturnType, UnstakeParams } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useUnstakeApprove}. The `action` literal is injected by the hook.
 */
export type UseUnstakeApproveVars<K extends SpokeChainKey = SpokeChainKey> = {
  params: Omit<UnstakeParams<K>, 'action'>;
  walletProvider: GetWalletProviderType<K>;
};

/**
 * React hook for approving xSODA spending on the unstake action.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped tx return value on success.
 */
export function useUnstakeApprove<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseUnstakeApproveVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseUnstakeApproveVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseUnstakeApproveVars<K>>({
    mutationKey: ['staking', 'approve', 'unstake'],
    ...mutationOptions,
    mutationFn: async ({ params, walletProvider }) =>
      unwrapResult(
        await sodax.staking.approve({
          params: { ...params, action: 'unstake' },
          raw: false,
          walletProvider,
        }),
      ),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['staking', 'allowance', vars.params.srcChainKey, 'unstake'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
