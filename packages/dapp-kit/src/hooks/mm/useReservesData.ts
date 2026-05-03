import type { AggregatedReserveData, BaseCurrencyInfo } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseReservesDataParams = ReadHookParams<readonly [readonly AggregatedReserveData[], BaseCurrencyInfo]>;

/**
 * React hook for fetching the latest aggregated reserves data and base-currency info from the
 * Sodax money market.
 */
export function useReservesData({
  queryOptions,
}: UseReservesDataParams = {}): UseQueryResult<readonly [readonly AggregatedReserveData[], BaseCurrencyInfo], Error> {
  const { sodax } = useSodaxContext();

  return useQuery({
    queryKey: ['mm', 'reservesData'],
    queryFn: async () => sodax.moneyMarket.data.getReservesData(),
    refetchInterval: 5000,
    ...queryOptions,
  });
}
