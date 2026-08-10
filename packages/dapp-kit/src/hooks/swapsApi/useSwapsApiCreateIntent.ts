import type { CreateIntentParamsV2, CreateIntentResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useSwapsApiCreateIntent}. The per-request `apiConfig` override
 * belongs here rather than at the hook level.
 */
export type UseSwapsApiCreateIntentVars = {
  body: CreateIntentParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook to build an unsigned create-intent transaction via the swaps API —
 * `sodax.api.swaps.createIntent`. Returns `{ tx, intent, relayData }` to sign and broadcast
 * yourself; it does not change state, so no queries are invalidated.
 *
 * The body is forwarded verbatim, so `partnerFee` has no default here and the SDK's client-side fee
 * config never reaches this path — see `SwapExtrasV2.partnerFee`. A monetizing app must put it in
 * `body`, matching the value it sent to {@link useSwapsApiQuote}, or the swap earns nothing and is
 * unattributable.
 *
 * @example
 * const { mutateAsync: createIntent } = useSwapsApiCreateIntent();
 * const { tx, intent, relayData } = await createIntent({ body: createIntentParams });
 */
export const useSwapsApiCreateIntent = ({
  mutationOptions,
}: MutationHookParams<CreateIntentResponseV2, UseSwapsApiCreateIntentVars> = {}): SafeUseMutationResult<
  CreateIntentResponseV2,
  Error,
  UseSwapsApiCreateIntentVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<CreateIntentResponseV2, Error, UseSwapsApiCreateIntentVars>({
    mutationKey: ['swapsApi', 'createIntent'],
    retry: 3,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<CreateIntentResponseV2> =>
      unwrapResult(await sodax.api.swaps.createIntent(body, apiConfig)),
  });
};
