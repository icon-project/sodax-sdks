import type { HubAssetBalance } from '@sodax/sdk';
import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseHubAssetBalancesParams = ReadHookParams<
  HubAssetBalance[],
  {
    chainKey: SpokeChainKey | undefined;
    /** The user's address on the spoke chain. The SDK derives the hub wallet abstraction internally. */
    srcAddress: string | undefined;
  }
>;

/**
 * React hook to fetch the hub-side balances of every supported token on the given spoke chain
 * for the user's hub wallet (derived internally from `srcAddress` + `chainKey`). Disabled when
 * either input is missing. Throws on `!ok`.
 */
export function useHubAssetBalances({
  params,
  queryOptions,
}: UseHubAssetBalancesParams = {}): UseQueryResult<HubAssetBalance[], Error> {
  const { sodax } = useSodaxContext();
  const chainKey = params?.chainKey;
  const srcAddress = params?.srcAddress;

  return useQuery<HubAssetBalance[], Error>({
    queryKey: ['recovery', 'hubAssetBalances', chainKey, srcAddress],
    queryFn: async () => {
      if (!chainKey || !srcAddress) {
        throw new Error('chainKey and srcAddress are required');
      }
      const result = await sodax.recovery.fetchHubAssetBalances({ chainKey, srcAddress });
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!chainKey && !!srcAddress,
    staleTime: 10_000,
    ...queryOptions,
  });
}
