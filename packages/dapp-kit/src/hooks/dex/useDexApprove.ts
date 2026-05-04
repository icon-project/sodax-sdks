// packages/dapp-kit/src/hooks/dex/useDexApprove.ts
import type { AssetDepositAction, SpokeChainKey, TxReturnType } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useDexApprove}. Generic over `K extends SpokeChainKey` (defaults
 * to the full union). Sophisticated callers can lock K at the hook call site to narrow the
 * `walletProvider` and `params.srcChainKey` types.
 */
export type UseDexApproveVars<K extends SpokeChainKey = SpokeChainKey> = Omit<AssetDepositAction<K, false>, 'raw'>;

/**
 * React hook for approving ERC-20 token spending (or trustline establishment) for a DEX deposit.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped tx return value on success.
 */
export function useDexApprove<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseDexApproveVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseDexApproveVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseDexApproveVars<K>>({
    mutationKey: ['dex', 'approve'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.dex.assetService.approve({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({
        queryKey: ['dex', 'allowance', params.srcChainKey, params.asset, params.amount.toString()],
      });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
