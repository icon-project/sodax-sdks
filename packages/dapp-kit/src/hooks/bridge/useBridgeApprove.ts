// packages/dapp-kit/src/hooks/bridge/useBridgeApprove.ts
import type { BridgeParams, SpokeChainKey, TxReturnType } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useBridgeApprove}. Generic over `K extends SpokeChainKey`
 * (defaults to the full union). Sophisticated callers can lock K at the hook call site to narrow
 * the `walletProvider` and `params.srcChainKey` types.
 */
export type UseBridgeApproveVars<K extends SpokeChainKey = SpokeChainKey> = Omit<BridgeParams<K, false>, 'raw'>;

/**
 * React hook for approving ERC-20 token spending (or trustline establishment) for a bridge
 * action.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped tx return value on success. Invalidates all
 * `['bridge', 'allowance', ...]` queries so any pending allowance check refreshes.
 */
export function useBridgeApprove<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseBridgeApproveVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseBridgeApproveVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseBridgeApproveVars<K>>({
    mutationKey: ['bridge', 'approve'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.bridge.approve({ ...vars, raw: false } as BridgeParams<K, false>)),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['bridge', 'allowance'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
