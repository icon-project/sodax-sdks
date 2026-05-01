import type { HubAssetBalance } from '@sodax/sdk';
import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';

export type UseHubAssetBalancesProps = {
  chainKey: SpokeChainKey | undefined;
  /** The user's address on the spoke chain. The SDK derives the hub wallet abstraction internally. */
  srcAddress: string | undefined;
  queryOptions?: Omit<UseQueryOptions<HubAssetBalance[], Error>, 'queryKey' | 'queryFn' | 'enabled'>;
};

/**
 * React hook to fetch the hub-side balances of every supported token on the given spoke chain
 * for the user's hub wallet (derived internally from `srcAddress` + `chainKey`). Disabled when
 * either input is missing. Throws on `!ok`.
 */
export function useHubAssetBalances({
  chainKey,
  srcAddress,
  queryOptions,
}: UseHubAssetBalancesProps): UseQueryResult<HubAssetBalance[], Error> {
  const { sodax } = useSodaxContext();

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
