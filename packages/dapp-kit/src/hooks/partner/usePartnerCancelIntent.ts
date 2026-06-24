// packages/dapp-kit/src/hooks/partner/usePartnerCancelIntent.ts
import type { HubChainKey, PartnerFeeClaimCancelAction, TxReturnType } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UsePartnerCancelIntentVars = Omit<PartnerFeeClaimCancelAction<HubChainKey, false>, 'raw'>;

/**
 * React hook to cancel a stuck partner fee-claim auto-swap intent and recover the locked tokens.
 *
 * Calls `ProtocolIntents.cancelIntent(fromToken, toToken)` — the only authorized cancel path for
 * partner auto-swap intents (the generic swap-cancel reverts because ProtocolIntents, not the
 * partner, is the intent creator). The contract cancels the intent and refunds the input amount to
 * the partner. Use this to recover funds from an unfillable same-token claim.
 *
 * Throws on SDK failure so React Query's native error model engages. Returns the transaction hash.
 */
export function usePartnerCancelIntent({
  mutationOptions,
}: MutationHookParams<TxReturnType<HubChainKey, false>, UsePartnerCancelIntentVars> = {}): SafeUseMutationResult<
  TxReturnType<HubChainKey, false>,
  Error,
  UsePartnerCancelIntentVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<HubChainKey, false>, Error, UsePartnerCancelIntentVars>({
    mutationKey: ['partner', 'cancelIntent'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.partners.feeClaim.cancelIntent<false>({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({
        queryKey: ['partner', 'feeClaim', 'assetsBalances', vars.params.srcAddress],
      });
      queryClient.invalidateQueries({
        queryKey: ['partner', 'feeClaim', 'userIntent', vars.params.srcAddress],
      });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
