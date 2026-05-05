// packages/dapp-kit/src/hooks/backend/useBackendSubmitSwapTx.ts
import type { RequestOverrideConfig, SubmitSwapTxRequest, SubmitSwapTxResponse } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useBackendSubmitSwapTx}. The per-request `apiConfig` override
 * (e.g. base URL) belongs here rather than at the hook level — different submissions in the same
 * component can target different endpoints without re-rendering.
 */
export type UseBackendSubmitSwapTxVars = {
  request: SubmitSwapTxRequest;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook for submitting a swap transaction to be processed by the backend (relay, post
 * execution to solver, etc.).
 *
 * Pure mutation: pass `{ request, apiConfig? }` to `mutate({...})`. Default `retry: 3` is applied
 * at the hook level — consumers can override via `mutationOptions.retry`.
 *
 * @example
 * const { mutateAsync: submitSwapTx, isPending, error } = useBackendSubmitSwapTx();
 *
 * const result = await submitSwapTx({
 *   request: { txHash: '0x123...', srcChainKey: 'sonic', walletAddress: '0xabc...', intent: { ... }, relayData: '0x...' },
 *   apiConfig: { baseURL: 'https://...' },
 * });
 */
export const useBackendSubmitSwapTx = ({
  mutationOptions,
}: MutationHookParams<SubmitSwapTxResponse, UseBackendSubmitSwapTxVars> = {}): SafeUseMutationResult<
  SubmitSwapTxResponse,
  Error,
  UseBackendSubmitSwapTxVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<SubmitSwapTxResponse, Error, UseBackendSubmitSwapTxVars>({
    mutationKey: ['backend', 'submitSwapTx'],
    retry: 3,
    ...mutationOptions,
    mutationFn: async ({ request, apiConfig }): Promise<SubmitSwapTxResponse> =>
      unwrapResult(await sodax.backendApi.submitSwapTx(request, apiConfig)),
  });
};
