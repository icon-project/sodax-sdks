import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IntentResponse } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBackendIntentByHashParams = ReadHookParams<
  IntentResponse | undefined,
  {
    intentHash: string | undefined;
  }
>;

/**
 * React hook to fetch intent details from the backend API using an intent hash.
 *
 * @example
 * const { data: intent } = useBackendIntentByHash({ params: { intentHash: '0xabc...' } });
 */
export const useBackendIntentByHash = ({
  params,
  queryOptions,
}: UseBackendIntentByHashParams = {}): UseQueryResult<IntentResponse | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const intentHash = params?.intentHash;

  return useQuery({
    queryKey: ['api', 'intent', 'hash', intentHash],
    queryFn: async (): Promise<IntentResponse | undefined> => {
      if (!intentHash) return undefined;
      const result = await sodax.backendApi.getIntentByHash(intentHash);
      return result.ok ? result.value : undefined;
    },
    enabled: !!intentHash && intentHash.length > 0,
    retry: 3,
    ...queryOptions,
  });
};
