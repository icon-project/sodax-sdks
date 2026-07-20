import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { GaslessPrepareRequest, GaslessPrepareResponse } from '@sodax/sdk';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import { type GaslessSource, resolveGaslessClient } from './gaslessClient.js';

/** Mutation variables for {@link useGaslessPrepare}: {@link GaslessPrepareRequest} plus an optional `source` (`'brain'` or `'api'`). */
export type UseGaslessPrepareVars = GaslessPrepareRequest & { source?: GaslessSource };

/** Build a sponsored gasless deposit and return the artifacts the EOA must sign ({@link GaslessPrepareResponse}); stateless — pair with {@link useGaslessSubmit} after signing. */
export function useGaslessPrepare({
  mutationOptions,
}: MutationHookParams<GaslessPrepareResponse, UseGaslessPrepareVars> = {}): SafeUseMutationResult<
  GaslessPrepareResponse,
  Error,
  UseGaslessPrepareVars
> {
  const { sodax } = useSodaxContext();

  return useSafeMutation<GaslessPrepareResponse, Error, UseGaslessPrepareVars>({
    mutationKey: ['gasless', 'prepare'],
    ...mutationOptions,
    mutationFn: async ({ source, ...body }) => unwrapResult(await resolveGaslessClient(sodax, source).prepare(body)),
  });
}
