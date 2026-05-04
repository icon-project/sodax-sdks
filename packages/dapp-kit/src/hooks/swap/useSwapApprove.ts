// packages/dapp-kit/src/hooks/swap/useSwapApprove.ts
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { useQueryClient } from '@tanstack/react-query';
import type {
  CreateIntentParams,
  CreateLimitOrderParams,
  GetWalletProviderType,
  SpokeChainKey,
  TxReturnType,
} from '@sodax/sdk';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useSwapApprove}. Generic over `K extends SpokeChainKey` (defaults
 * to the full union). Sophisticated callers can lock K at the call site to narrow the
 * `walletProvider` and `params.srcChainKey` types.
 */
export type UseSwapApproveVars<K extends SpokeChainKey = SpokeChainKey> = {
  params: CreateIntentParams<K> | CreateLimitOrderParams<K>;
  walletProvider: GetWalletProviderType<K>;
};

/**
 * React hook for approving ERC-20 token spending (or trustline establishment) for a swap or
 * limit-order intent.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped tx return value on success. Invalidates all
 * `['swap', 'allowance', ...]` queries so any pending allowance check refreshes.
 */
export function useSwapApprove<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseSwapApproveVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseSwapApproveVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseSwapApproveVars<K>>({
    mutationKey: ['swap', 'approve'],
    ...mutationOptions,
    mutationFn: async ({ params, walletProvider }) =>
      unwrapResult(
        await sodax.swaps.approve<K, false>({
          params: params as CreateIntentParams<K>,
          raw: false,
          walletProvider,
        }),
      ),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['swap', 'allowance'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
