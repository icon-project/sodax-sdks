import type { PoolKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UsePoolsParams = ReadHookParams<PoolKey[]>;

/**
 * Loads the list of concentrated-liquidity pools known to the SDK config. The SDK's `getPools()`
 * is synchronous in v2 (no network), so this hook caches indefinitely by default.
 */
export function usePools({ queryOptions }: UsePoolsParams = {}): UseQueryResult<PoolKey[], Error> {
  const { sodax } = useSodaxContext();

  return useQuery<PoolKey[], Error>({
    queryKey: ['dex', 'pools'],
    queryFn: () => sodax.dex.clService.getPools(),
    staleTime: Number.POSITIVE_INFINITY,
    ...queryOptions,
  });
}
