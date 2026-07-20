import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { GaslessSubmitRequest, GaslessSubmitResponse } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import { type GaslessSource, resolveGaslessClient } from './gaslessClient.js';

/** Mutation variables for {@link useGaslessSubmit}: {@link GaslessSubmitRequest} (echoed `prepared` + the EOA's `signatures`) plus an optional `source`. */
export type UseGaslessSubmitVars = GaslessSubmitRequest & { source?: GaslessSource };

/** Attach the EOA signature(s) to a prepared gasless deposit and broadcast via the bundler ({@link GaslessSubmitResponse}). Execution-only — relay the returned hash with {@link useGaslessRelay}. */
export function useGaslessSubmit({
  mutationOptions,
}: MutationHookParams<GaslessSubmitResponse, UseGaslessSubmitVars> = {}): SafeUseMutationResult<
  GaslessSubmitResponse,
  Error,
  UseGaslessSubmitVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<GaslessSubmitResponse, Error, UseGaslessSubmitVars>({
    mutationKey: ['gasless', 'submit'],
    ...mutationOptions,
    mutationFn: async ({ source, ...body }) => unwrapResult(await resolveGaslessClient(sodax, source).submit(body)),
    // submit executes the spoke-side [approve, transfer] on-chain, so the source-chain balance changed.
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['shared', 'xBalances', vars.prepared.srcChainKey] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
