import { useCallback, useRef } from 'react';
import { useEstablishTrustline, type UseEstablishTrustlineVars } from './useEstablishTrustline.js';

/**
 * The shape released in 2.0.0. Declared explicitly so a change to it fails
 * `checkTs` here rather than silently breaking consumers.
 */
type ReleasedRequestTrustline = {
  requestTrustline: (params: UseEstablishTrustlineVars) => Promise<string>;
  isLoading: boolean;
  isRequested: boolean;
  error: Error | null;
  data: string | null;
};

/**
 * Establish a Stellar trustline.
 *
 * @deprecated Use {@link useEstablishTrustline}, the canonical mutation hook, which exposes
 * `mutate` / `mutateAsync` / `mutateAsyncSafe` and accepts `mutationOptions`. This wrapper
 * preserves the shape released in 2.0.0 and will be removed in the next major.
 *
 * @param token - Ignored, as it was in 2.0.0. Accepted only so existing call sites compile.
 */
export function useRequestTrustline(token?: string | undefined): ReleasedRequestTrustline {
  const { mutateAsync, isPending, isSuccess, error, data } = useEstablishTrustline();

  // 2.0.0 held `isRequested` and `data` in component state and never cleared them, whereas
  // React Query resets its equivalents when the next attempt starts. Latch to keep the
  // released semantics: a retry that fails must not un-report the trustline that succeeded.
  const requested = useRef(false);
  const lastData = useRef<string | null>(null);
  if (isSuccess) requested.current = true;
  if (data !== undefined) lastData.current = data;

  const requestTrustline = useCallback(
    async (params: UseEstablishTrustlineVars): Promise<string> => {
      try {
        return await mutateAsync(params);
      } catch (err) {
        // 2.0.0 guaranteed this callback rejects with an `Error`.
        throw err instanceof Error ? err : new Error('Unknown error occurred');
      }
    },
    [mutateAsync],
  );

  return {
    requestTrustline,
    isLoading: isPending,
    isRequested: requested.current,
    error,
    data: lastData.current,
  };
}
