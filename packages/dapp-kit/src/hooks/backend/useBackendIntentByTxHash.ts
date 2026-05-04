import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IntentResponse } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBackendIntentByTxHashParams = ReadHookParams<
  IntentResponse | undefined,
  {
    txHash: string | undefined;
  }
>;

/**
 * React hook for fetching intent details from the backend API using a transaction hash.
 *
 * @example
 * const { data: intent } = useBackendIntentByTxHash({ params: { txHash: '0x123...' } });
 *
 * @remarks
 * - Intents are only created on the hub chain, so `txHash` must originate from there.
 * - Default refetch interval is 1 second.
 */
export const useBackendIntentByTxHash = ({
  params,
  queryOptions,
}: UseBackendIntentByTxHashParams = {}): UseQueryResult<IntentResponse | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const txHash = params?.txHash;

  return useQuery({
    queryKey: ['backend', 'intent', 'txHash', txHash],
    queryFn: async (): Promise<IntentResponse | undefined> => {
      if (!txHash) return undefined;
      const result = await sodax.backendApi.getIntentByTxHash(txHash);
      return result.ok ? result.value : undefined;
    },
    enabled: !!txHash && txHash.length > 0,
    retry: 3,
    refetchInterval: 1000,
    ...queryOptions,
  });
};
