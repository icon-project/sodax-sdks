// packages/dapp-kit/src/hooks/mm/useMMApprove.ts
import type { MoneyMarketApproveActionParams, SpokeChainKey, TxReturnType } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useMMApprove}. Generic over `K extends SpokeChainKey` (defaults
 * to the full union). Sophisticated callers can lock K at the hook call site to narrow the
 * `walletProvider` and `params.srcChainKey` types.
 */
export type UseMMApproveVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  MoneyMarketApproveActionParams<K, false>,
  'raw'
>;

/**
 * React hook for approving ERC-20 token spending (or trustline establishment) for a Sodax money
 * market action.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped tx return value on success. Invalidates the matching
 * `['mm', 'allowance', srcChainKey, token, action]` query on confirmed success.
 */
export function useMMApprove<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseMMApproveVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseMMApproveVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseMMApproveVars<K>>({
    mutationKey: ['mm', 'approve'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.moneyMarket.approve({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({
        queryKey: ['mm', 'allowance', params.srcChainKey, params.token, params.action],
      });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
