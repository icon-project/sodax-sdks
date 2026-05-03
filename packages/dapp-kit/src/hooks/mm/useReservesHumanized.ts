import type { ReservesDataHumanized } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseReservesHumanizedParams = ReadHookParams<ReservesDataHumanized>;

/**
 * React hook for fetching the human-readable (decimal-normalized, string-formatted) reserves
 * snapshot from the Sodax money market.
 */
export function useReservesHumanized({
  queryOptions,
}: UseReservesHumanizedParams = {}): UseQueryResult<ReservesDataHumanized, Error> {
  const { sodax } = useSodaxContext();

  return useQuery({
    queryKey: ['mm', 'reservesHumanized'],
    queryFn: async () => sodax.moneyMarket.data.getReservesHumanized(),
    refetchInterval: 5000,
    ...queryOptions,
  });
}
