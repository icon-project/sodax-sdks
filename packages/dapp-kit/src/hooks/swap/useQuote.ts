import type { SolverErrorResponse, SolverIntentQuoteRequest, SolverIntentQuoteResponse } from '@sodax/sdk';
import type { Result } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReadHookParams } from '../shared/types.js';

export type UseQuoteParams = ReadHookParams<
  Result<SolverIntentQuoteResponse, SolverErrorResponse> | undefined,
  { payload: SolverIntentQuoteRequest | undefined }
>;

/**
 * Hook for fetching a quote for an intent-based swap.
 *
 * @example
 * ```typescript
 * const { data: quote, isLoading } = useQuote({ params: { payload } });
 * ```
 *
 * @remarks
 * - The quote is automatically refreshed every 3 seconds
 * - The query is disabled when payload is undefined
 */
export const useQuote = ({
  params,
  queryOptions,
}: UseQuoteParams = {}): UseQueryResult<Result<SolverIntentQuoteResponse, SolverErrorResponse> | undefined> => {
  const { sodax } = useSodaxContext();
  const payload = params?.payload;

  return useQuery({
    queryKey: ['quote', payload && { ...payload, amount: payload.amount.toString() }],
    queryFn: async () => {
      if (!payload) {
        return undefined;
      }
      return sodax.swaps.getQuote(payload);
    },
    enabled: !!payload,
    refetchInterval: 3000,
    ...queryOptions,
  });
};
