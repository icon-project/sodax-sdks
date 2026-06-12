import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { QuoteQueryV2, QuoteRequestV2, QuoteResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseSwapsApiQuoteParams = ReadHookParams<
  QuoteResponseV2 | undefined,
  {
    body: QuoteRequestV2 | undefined;
    query?: QuoteQueryV2;
    apiConfig?: RequestOverrideConfig;
  }
>;

/**
 * React hook to get a solver quote for a cross-chain swap via the swaps API —
 * `sodax.api.swaps.getQuote`. Pass `query.includeTxData = true` to also build an unsigned
 * create-intent transaction (`txData`); `srcAddress`/`dstAddress` are then required in the body.
 *
 * @example
 * const { data: quote } = useSwapsApiQuote({
 *   params: {
 *     body: {
 *       tokenSrc: '0x...', tokenSrcChainKey: '0xa4b1.arbitrum',
 *       tokenDst: '0x...', tokenDstChainKey: 'sonic',
 *       amount: '1000000', quoteType: 'exact_input',
 *     },
 *   },
 * });
 */
export const useSwapsApiQuote = ({
  params,
  queryOptions,
}: UseSwapsApiQuoteParams = {}): UseQueryResult<QuoteResponseV2 | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const body = params?.body;
  const query = params?.query;
  const apiConfig = params?.apiConfig;

  return useQuery({
    queryKey: [
      'swapsApi',
      'quote',
      body?.tokenSrcChainKey,
      body?.tokenSrc,
      body?.tokenDstChainKey,
      body?.tokenDst,
      body?.amount,
      query?.includeTxData ?? false,
    ],
    queryFn: async (): Promise<QuoteResponseV2 | undefined> => {
      if (!body) return undefined;
      return unwrapResult(await sodax.api.swaps.getQuote(body, query, apiConfig));
    },
    enabled: !!body,
    retry: 3,
    ...queryOptions,
  });
};
