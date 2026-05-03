import type { Hex, SolverErrorResponse, SolverIntentStatusResponse } from '@sodax/sdk';
import type { Result } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseStatusParams = ReadHookParams<
  Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined,
  { intentTxHash: Hex | undefined }
>;

/**
 * Hook for monitoring the status of an intent-based swap.
 *
 * @example
 * ```typescript
 * const { data: status, isLoading } = useStatus({ params: { intentTxHash } });
 * ```
 */
export const useStatus = ({
  params,
  queryOptions,
}: UseStatusParams = {}): UseQueryResult<Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined> => {
  const { sodax } = useSodaxContext();
  const intentTxHash = params?.intentTxHash;

  return useQuery({
    queryKey: ['swap', 'status', intentTxHash],
    queryFn: async () => {
      if (!intentTxHash) return undefined;
      return sodax.swaps.getStatus({ intent_tx_hash: intentTxHash });
    },
    enabled: !!intentTxHash,
    refetchInterval: 3000,
    ...queryOptions,
  });
};
