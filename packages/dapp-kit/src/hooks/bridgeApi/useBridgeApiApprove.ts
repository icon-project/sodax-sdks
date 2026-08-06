import type { BridgeApproveResponseV2, CreateBridgeIntentParamsV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useBridgeApiApprove}. The per-request `apiConfig` override belongs
 * here rather than at the hook level — different calls in the same component can target different
 * endpoints without re-rendering.
 */
export type UseBridgeApiApproveVars = {
  body: CreateBridgeIntentParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook to build an unsigned token-approval transaction for the source token via the bridge
 * API — `sodax.api.bridge.approve`. Returns `{ tx }` (chain-specific unsigned tx) to sign and
 * broadcast yourself; it does not change state, so no queries are invalidated.
 *
 * @example
 * const { mutateAsync: approve } = useBridgeApiApprove();
 * const { tx } = await approve({ body: createBridgeIntentParams });
 */
export const useBridgeApiApprove = ({
  mutationOptions,
}: MutationHookParams<BridgeApproveResponseV2, UseBridgeApiApproveVars> = {}): SafeUseMutationResult<
  BridgeApproveResponseV2,
  Error,
  UseBridgeApiApproveVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<BridgeApproveResponseV2, Error, UseBridgeApiApproveVars>({
    mutationKey: ['bridgeApi', 'approve'],
    retry: 3,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<BridgeApproveResponseV2> =>
      unwrapResult(await sodax.api.bridge.approve(body, apiConfig)),
  });
};
