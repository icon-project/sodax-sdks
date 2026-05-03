import type { CreateAssetDepositParams } from '@sodax/sdk';
import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseDexAllowanceParams<K extends SpokeChainKey = SpokeChainKey> = ReadHookParams<
  boolean,
  {
    payload: CreateAssetDepositParams<K> | undefined;
  }
>;

/**
 * React hook to check whether the user has approved sufficient token allowance (or established a
 * trustline, on Stellar) for a DEX deposit. Read-only — calls `assetService.isAllowanceValid`
 * with `raw: true` so no `walletProvider` is required.
 */
export function useDexAllowance<K extends SpokeChainKey = SpokeChainKey>({
  params,
  queryOptions,
}: UseDexAllowanceParams<K> = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  const payload = params?.payload;

  return useQuery<boolean, Error>({
    queryKey: ['dex', 'allowance', payload?.srcChainKey, payload?.asset, payload?.amount?.toString()],
    queryFn: async () => {
      if (!payload) {
        throw new Error('Params are required');
      }
      const result = await sodax.dex.assetService.isAllowanceValid({ params: payload, raw: true });
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!payload,
    refetchInterval: 5_000,
    gcTime: 0,
    ...queryOptions,
  });
}
