import type { SwapsRequestOverrideConfig, SubmitIntentRequestV2, SubmitIntentResponseV2 } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useSwapsApiSubmitIntent}. The per-request `apiConfig` override
 * belongs here rather than at the hook level.
 */
export type UseSwapsApiSubmitIntentVars = {
  body: SubmitIntentRequestV2;
  apiConfig?: SwapsRequestOverrideConfig;
};

/**
 * React hook to submit the broadcast intent tx to the relay via the swaps API —
 * `sodax.api.swaps.submitIntent`. Returns `{ result }` (opaque relay response).
 *
 * No auto-retry (`retry: false`): submitting is non-idempotent — a retry after a lost response
 * could double-submit to the relay. Override via `mutationOptions.retry` if your relay dedupes.
 *
 * @example
 * const { mutateAsync: submitIntent } = useSwapsApiSubmitIntent();
 * const { result } = await submitIntent({ body: { chainId: '146', txHash: '0x123...' } });
 */
export const useSwapsApiSubmitIntent = ({
  mutationOptions,
}: MutationHookParams<SubmitIntentResponseV2, UseSwapsApiSubmitIntentVars> = {}): SafeUseMutationResult<
  SubmitIntentResponseV2,
  Error,
  UseSwapsApiSubmitIntentVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<SubmitIntentResponseV2, Error, UseSwapsApiSubmitIntentVars>({
    mutationKey: ['swapsApi', 'submitIntent'],
    retry: false,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<SubmitIntentResponseV2> =>
      unwrapResult(await sodax.api.swaps.submitIntent(body, apiConfig)),
  });
};
