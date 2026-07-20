import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { GaslessRelayParams, GaslessRelayResult } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** Mutation variables for {@link useGaslessRelay} — the full {@link GaslessRelayParams}. */
export type UseGaslessRelayVars = GaslessRelayParams;

/** Complete the hub-delivery tail after an execution-only submit / sendCalls: relay the spoke tx hash to the hub and wait for settlement. */
export function useGaslessRelay({
  mutationOptions,
}: MutationHookParams<GaslessRelayResult, UseGaslessRelayVars> = {}): SafeUseMutationResult<
  GaslessRelayResult,
  Error,
  UseGaslessRelayVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<GaslessRelayResult, Error, UseGaslessRelayVars>({
    mutationKey: ['gasless', 'relay'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.gasless.relay(vars)),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['shared', 'xBalances', vars.srcChainKey] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
