import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { SolverExecutionRequest, SolverExecutionResponse } from '@sodax/sdk';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** Mutation variables for {@link useLeverageYieldNotifySolver} — the hub-side intent tx hash. */
export type UseLeverageYieldNotifySolverVars = SolverExecutionRequest;

/**
 * Notifies the solver that a leverage-yield vault intent landed on the hub, triggering the fill.
 * The standalone notify step for the manual create → relay → notify flow: build the intent with
 * `sodax.leverageYield.createVaultIntent`, relay it yourself, then call this with the hub-side
 * intent tx hash. The end-to-end {@link useLeverageYieldVaultSwap} already calls notifySolver
 * internally — only reach for this hook when driving the relay manually.
 *
 * Throws on SDK failure so React Query's error model engages; returns the unwrapped
 * `SolverExecutionResponse` (`{ answer: 'OK', intent_hash }`) on success.
 */
export function useLeverageYieldNotifySolver({
  mutationOptions,
}: MutationHookParams<SolverExecutionResponse, UseLeverageYieldNotifySolverVars> = {}): SafeUseMutationResult<
  SolverExecutionResponse,
  Error,
  UseLeverageYieldNotifySolverVars
> {
  const { sodax } = useSodaxContext();

  return useSafeMutation<SolverExecutionResponse, Error, UseLeverageYieldNotifySolverVars>({
    mutationKey: ['leverageYield', 'notifySolver'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.leverageYield.notifySolver(vars)),
  });
}
