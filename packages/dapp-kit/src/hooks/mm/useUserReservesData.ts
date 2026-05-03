import type { UserReserveData } from '@sodax/sdk';
import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseUserReservesDataParams = ReadHookParams<
  readonly [readonly UserReserveData[], number],
  {
    spokeChainKey: SpokeChainKey | undefined;
    userAddress: string | undefined;
  }
>;

/**
 * React hook for fetching the raw user reserves data (positions on the hub) for a given spoke
 * chain and user address.
 */
export function useUserReservesData({
  params,
  queryOptions,
}: UseUserReservesDataParams = {}): UseQueryResult<readonly [readonly UserReserveData[], number], Error> {
  const { sodax } = useSodaxContext();
  const spokeChainKey = params?.spokeChainKey;
  const userAddress = params?.userAddress;

  return useQuery({
    queryKey: ['mm', 'userReservesData', spokeChainKey, userAddress],
    queryFn: async () => {
      if (!spokeChainKey || !userAddress) {
        throw new Error('spokeChainKey and userAddress are required');
      }
      return sodax.moneyMarket.data.getUserReservesData(spokeChainKey, userAddress);
    },
    enabled: !!spokeChainKey && !!userAddress,
    refetchInterval: 5000,
    ...queryOptions,
  });
}
