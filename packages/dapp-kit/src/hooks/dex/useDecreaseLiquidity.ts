// packages/dapp-kit/src/hooks/dex/useDecreaseLiquidity.ts
import type { ClLiquidityDecreaseLiquidityAction, SpokeChainKey, TxHashPair } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useDecreaseLiquidity}. Generic over `K extends SpokeChainKey`
 * (defaults to the full union). Sophisticated callers can lock K at the hook call site to narrow
 * the `walletProvider` and `params.srcChainKey` types.
 */
export type UseDecreaseLiquidityVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  ClLiquidityDecreaseLiquidityAction<K, false>,
  'raw'
>;

/**
 * React hook for decreasing liquidity in an existing concentrated-liquidity position.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `TxHashPair` on success.
 */
export function useDecreaseLiquidity<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseDecreaseLiquidityVars<K>> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseDecreaseLiquidityVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseDecreaseLiquidityVars<K>>({
    mutationKey: ['dex', 'decreaseLiquidity'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.dex.clService.decreaseLiquidity({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      // Decrease always targets a known position — scope invalidation to (tokenId, poolKey) instead
      // of wiping all positions. `usePositionInfo` keys by string tokenId, so stringify the bigint
      // here to keep the structural match.
      queryClient.invalidateQueries({
        queryKey: ['dex', 'positionInfo', params.tokenId.toString(), params.poolKey],
      });
      queryClient.invalidateQueries({ queryKey: ['dex', 'poolData', params.poolKey] });
      queryClient.invalidateQueries({ queryKey: ['dex', 'poolBalances', params.srcChainKey, params.srcAddress] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
