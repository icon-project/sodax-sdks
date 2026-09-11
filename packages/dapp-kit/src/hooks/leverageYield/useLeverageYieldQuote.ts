import type { LeverageYieldQuoteParams, PartnerFee, Sodax } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

/**
 * Derived from the SDK method rather than restated, so the public error union
 * (`SolverErrorResponse | LeverageYieldLookupError`) stays exact and cannot drift.
 * `undefined` is the disabled state, before a `payload` exists.
 */
type LeverageYieldQuote = Awaited<ReturnType<Sodax['leverageYield']['getQuote']>> | undefined;

export type UseLeverageYieldQuoteParams = ReadHookParams<
  LeverageYieldQuote,
  { payload: LeverageYieldQuoteParams | undefined }
>;

type LeverageYieldQuoteReader = {
  config: Pick<Sodax['config'], 'leverageYieldPartnerFee'>;
  leverageYield: Pick<Sodax['leverageYield'], 'getQuote'>;
};

/** React Query hashes keys with `JSON.stringify`, which throws on a bigint fee amount. */
function feeKeyPart(fee: PartnerFee | undefined) {
  if (!fee) return undefined;
  return 'amount' in fee ? { ...fee, amount: fee.amount.toString() } : fee;
}

/**
 * Keys on the **effective** fee, not `payload.partnerFee`: when the caller omits it, `getQuote`
 * falls back to `config.leverageYieldPartnerFee`, so the configured fee is a real input to the
 * result. Leaving it out lets two providers configured with different fees share one cache entry,
 * and lets a reconfigured provider serve the previous fee's quote until the next poll — either way
 * a `minOutputAmount` derived from that quote can be unfillable.
 *
 * Fields are named explicitly rather than spread. A spread would carry any future bigint field on
 * `SolverIntentQuoteRequest` straight into the key, and React Query hashes keys with
 * `JSON.stringify`, which throws on bigint — so a spread fails *open* into a render crash, while an
 * allow-list fails *closed* into a missing key segment. Add new fields here deliberately.
 *
 * `String(...)` rather than `.toString()`: a payload assembled from partially-validated form state
 * may not have an `amount` yet, and key derivation runs during render. Staying total lets the SDK's
 * own validation surface it as a `VALIDATION_FAILED` result instead of throwing past React Query.
 */
function quoteKeyPart(payload: LeverageYieldQuoteParams | undefined, effectiveFee: PartnerFee | undefined) {
  if (!payload) return undefined;
  return {
    token_src: payload.token_src,
    token_src_blockchain_id: payload.token_src_blockchain_id,
    token_dst: payload.token_dst,
    token_dst_blockchain_id: payload.token_dst_blockchain_id,
    amount: String(payload.amount),
    quote_type: payload.quote_type,
    partnerFee: feeKeyPart(effectiveFee),
  };
}

export function getLeverageYieldQuoteQueryOptions({
  sodax,
  payload,
}: {
  sodax: LeverageYieldQuoteReader;
  payload: LeverageYieldQuoteParams | undefined;
}) {
  const effectiveFee = payload?.partnerFee ?? sodax.config.leverageYieldPartnerFee;
  return {
    queryKey: ['leverageYield', 'quote', quoteKeyPart(payload, effectiveFee)],
    queryFn: async (): Promise<LeverageYieldQuote> => {
      if (!payload) return undefined;
      return sodax.leverageYield.getQuote(payload);
    },
    enabled: !!payload,
    refetchInterval: 3000,
  };
}

/**
 * Quotes a leverage-yield vault deposit or withdraw. Pass the vault address as `token_dst` to
 * quote a deposit, or as `token_src` to quote a withdraw; subtract your slippage tolerance from
 * `quoted_amount` to size `minOutputAmount`.
 *
 * Use this rather than {@link useQuote}: the swap quote deducts the effective *swap* fee, while a
 * vault intent charges the effective *leverage-yield* fee, so the two disagree whenever the feature
 * fees differ. When overriding the fee per intent, pass the same `partnerFee` here and to whichever
 * builder you use — `useLeverageYieldDeposit`, `useLeverageYieldWithdraw`, or
 * `useLeverageYieldVaultSwap` — or omit it on all of them, which resolves the same configured fee on
 * each side. Both directions are charged, so this applies to withdrawals as much as deposits.
 *
 * Returns the SDK `Result` as query data rather than unwrapping it, matching {@link useQuote}: a
 * quote failure ("no path", thin liquidity) is an expected UI branch, and keeping the `Result`
 * preserves the solver's `detail.code` instead of flattening it to an error message.
 *
 * @example
 * ```typescript
 * const { data: quote } = useLeverageYieldQuote({
 *   params: {
 *     payload: {
 *       token_src: inputToken,
 *       token_src_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
 *       token_dst: vault.vault,
 *       token_dst_blockchain_id: ChainKeys.SONIC_MAINNET,
 *       amount: parseUnits('1', 18),
 *       quote_type: 'exact_input',
 *     },
 *   },
 * });
 * if (quote?.ok) setMinOutput((quote.value.quoted_amount * 9_950n) / 10_000n);
 * ```
 *
 * @remarks
 * - Refreshes every 3 seconds, like `useQuote` — solver prices go stale.
 * - Disabled while `payload` is undefined.
 */
export function useLeverageYieldQuote({
  params,
  queryOptions,
}: UseLeverageYieldQuoteParams = {}): UseQueryResult<LeverageYieldQuote, Error> {
  const { sodax } = useSodaxContext();

  return useQuery<LeverageYieldQuote, Error>({
    ...getLeverageYieldQuoteQueryOptions({ sodax, payload: params?.payload }),
    ...queryOptions,
  });
}
