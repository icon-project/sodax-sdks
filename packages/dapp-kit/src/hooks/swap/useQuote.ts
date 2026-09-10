import type { PartnerFee, Sodax, SolverIntentQuoteRequest } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReadHookParams } from '../shared/types.js';

/**
 * Derived from the SDK method rather than restated, so the error union stays exact and cannot
 * drift. `undefined` is the disabled state, before a `payload` exists.
 */
type SwapQuote = Awaited<ReturnType<Sodax['swaps']['getQuote']>> | undefined;

export type UseQuoteParams = ReadHookParams<SwapQuote, { payload: SolverIntentQuoteRequest | undefined }>;

type SwapQuoteReader = { swaps: Pick<Sodax['swaps'], 'getQuote' | 'partnerFee'> };

/** React Query hashes keys with `JSON.stringify`, which throws on a bigint fee amount. */
function feeKeyPart(fee: PartnerFee | undefined) {
  if (!fee) return undefined;
  return 'amount' in fee ? { ...fee, amount: fee.amount.toString() } : fee;
}

/**
 * Includes the configured partner fee: `getQuote` deducts it from `amount` before quoting, so it
 * is a real input to the result even though it never appears in `payload`. Leaving it out lets two
 * providers configured with different fees share one cache entry, and lets a reconfigured provider
 * serve the previous fee's quote until the next poll — either way a `minOutputAmount` derived from
 * that quote can be unfillable.
 *
 * Fields are named explicitly rather than spread. A spread would carry any future bigint field on
 * `SolverIntentQuoteRequest` straight into the key, and `JSON.stringify` throws on bigint — so a
 * spread fails *open* into a render crash, while an allow-list fails *closed* into a missing key
 * segment. Add new fields here deliberately.
 *
 * `String(...)` rather than `.toString()`: a payload assembled from partially-validated form state
 * may not have an `amount` yet, and key derivation runs during render. Staying total lets the SDK's
 * own validation surface it instead of throwing past React Query.
 */
function quoteKeyPart(payload: SolverIntentQuoteRequest | undefined, configuredFee: PartnerFee | undefined) {
  if (!payload) return undefined;
  return {
    token_src: payload.token_src,
    token_src_blockchain_id: payload.token_src_blockchain_id,
    token_dst: payload.token_dst,
    token_dst_blockchain_id: payload.token_dst_blockchain_id,
    amount: String(payload.amount),
    quote_type: payload.quote_type,
    partnerFee: feeKeyPart(configuredFee),
  };
}

export function getSwapQuoteQueryOptions({
  sodax,
  payload,
}: {
  sodax: SwapQuoteReader;
  payload: SolverIntentQuoteRequest | undefined;
}) {
  return {
    queryKey: ['swap', 'quote', quoteKeyPart(payload, sodax.swaps.partnerFee)],
    queryFn: async (): Promise<SwapQuote> => {
      if (!payload) {
        return undefined;
      }
      return sodax.swaps.getQuote(payload);
    },
    enabled: !!payload,
    refetchInterval: 3000,
  };
}

/**
 * Hook for fetching a quote for an intent-based swap.
 *
 * For a leverage-yield vault deposit or withdraw use `useLeverageYieldQuote` instead — this hook
 * deducts the effective *swap* fee, which is not what a vault intent charges.
 *
 * @example
 * ```typescript
 * const { data: quote, isLoading } = useQuote({ params: { payload } });
 * ```
 *
 * @remarks
 * - The quote is automatically refreshed every 3 seconds
 * - The query is disabled when payload is undefined
 * - Returns the SDK `Result` as `data`; branch on `data?.ok` rather than reading `isError`
 */
export const useQuote = ({ params, queryOptions }: UseQuoteParams = {}): UseQueryResult<SwapQuote> => {
  const { sodax } = useSodaxContext();

  return useQuery({
    ...getSwapQuoteQueryOptions({ sodax, payload: params?.payload }),
    ...queryOptions,
  });
};
