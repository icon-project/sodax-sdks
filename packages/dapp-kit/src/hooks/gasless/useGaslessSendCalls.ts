import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { GaslessSendCallsParams, GaslessSendCallsResult } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** Mutation variables for {@link useGaslessSendCalls} — the full {@link GaslessSendCallsParams}, including the external EIP-5792 `walletProvider`. */
export type UseGaslessSendCallsVars = GaslessSendCallsParams;

/** Mode-A gasless path: execute the sponsored `[approve, transfer]` batch through an external EIP-5792 wallet (`wallet_sendCalls`). Execution-only — relay the result with {@link useGaslessRelay}. */
export function useGaslessSendCalls({
  mutationOptions,
}: MutationHookParams<GaslessSendCallsResult, UseGaslessSendCallsVars> = {}): SafeUseMutationResult<
  GaslessSendCallsResult,
  Error,
  UseGaslessSendCallsVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<GaslessSendCallsResult, Error, UseGaslessSendCallsVars>({
    mutationKey: ['gasless', 'sendCalls'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.gasless.sendCalls(vars)),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['shared', 'xBalances', vars.srcChainKey] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
