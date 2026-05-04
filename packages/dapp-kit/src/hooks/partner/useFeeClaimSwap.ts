// packages/dapp-kit/src/hooks/partner/useFeeClaimSwap.ts
import type { HubChainKey, IntentAutoSwapResult, PartnerFeeClaimSwapAction } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseFeeClaimSwapVars = Omit<PartnerFeeClaimSwapAction<HubChainKey, false>, 'raw'>;

/**
 * React hook to create a partner-fee auto-swap intent and wait for the solver execution.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `IntentAutoSwapResult` on success.
 */
export function useFeeClaimSwap({
  mutationOptions,
}: MutationHookParams<IntentAutoSwapResult, UseFeeClaimSwapVars> = {}): SafeUseMutationResult<
  IntentAutoSwapResult,
  Error,
  UseFeeClaimSwapVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<IntentAutoSwapResult, Error, UseFeeClaimSwapVars>({
    mutationKey: ['partner', 'feeClaimSwap'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.partners.feeClaim.swap({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({
        queryKey: ['partner', 'feeClaim', 'assetsBalances', vars.params.srcAddress],
      });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
