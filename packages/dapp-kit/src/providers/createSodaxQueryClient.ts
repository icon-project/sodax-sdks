// packages/dapp-kit/src/providers/createSodaxQueryClient.ts
import { MutationCache, QueryClient, type QueryClientConfig } from '@tanstack/react-query';

export type CreateSodaxQueryClientOptions = {
  /**
   * Called for every mutation failure (i.e. every time `mutationFn` throws) that does NOT opt out
   * via `meta: { silent: true }` on the mutation. Defaults to `console.error`.
   *
   * This is **global observability** — it runs alongside any per-hook `onError` handler the
   * consumer set, NOT instead of them. In particular, it fires:
   * - whether or not `mutateAsync` was awaited inside `try/catch`
   * - whether or not `mutateAsyncSafe` was used (the wrapper packs into `Result<T>` AFTER React
   *   Query has already entered the error state and dispatched its callbacks)
   * - whether or not the consumer's `mutationOptions.onError` already toasted/logged
   *
   * It is NOT a "did this rejection escape to the global handler?" detector — accurate
   * unhandled-rejection detection lives at `window.onunhandledrejection`, not here.
   *
   * To silence the default for a specific mutation that the consumer is handling locally, set
   * `meta: { silent: true }`:
   *
   * ```ts
   * useSwap({ mutationOptions: { meta: { silent: true }, onError: (e) => toast(e.message) } });
   * ```
   *
   * To disable the default globally (e.g. wire your own error boundary), pass a no-op:
   *
   * ```ts
   * createSodaxQueryClient({ onMutationError: () => {} });
   * ```
   */
  onMutationError?: (error: unknown) => void;
  /** Pass-through for any other QueryClient config (default queries options, etc.) */
  config?: QueryClientConfig;
};

const defaultOnMutationError = (error: unknown): void => {
  console.error('[sodax] Mutation error:', error);
};

/**
 * Creates a `QueryClient` pre-wired with a mutation-error observability hook that gives dapp-kit
 * consumers a single seam for every mutation failure across the app — wire to Sentry/Datadog/console
 * as you like. Optional opt-in: consumers who construct their own `QueryClient` are unaffected.
 *
 * **Composition with a custom `MutationCache`.** If you pass `config.mutationCache`, we keep your
 * cache instance (preserving its own `onError` / `onSuccess` / etc.) and *additionally* subscribe
 * to its event stream to dispatch `onMutationError`. Both your handler and the dapp-kit handler
 * fire — neither replaces the other. If you don't pass one, we install our own.
 *
 * @example default — logs to console
 * const queryClient = createSodaxQueryClient();
 *
 * @example custom — Sentry
 * const queryClient = createSodaxQueryClient({
 *   onMutationError: (e) => Sentry.captureException(e),
 * });
 *
 * @example silent — disable the default
 * const queryClient = createSodaxQueryClient({ onMutationError: () => {} });
 *
 * @example bring-your-own MutationCache
 * const myCache = new MutationCache({ onError: myOwnErrorHandler });
 * const queryClient = createSodaxQueryClient({ config: { mutationCache: myCache } });
 * // myOwnErrorHandler still runs; onMutationError ALSO runs (unless meta.silent).
 */
export function createSodaxQueryClient({
  onMutationError = defaultOnMutationError,
  config,
}: CreateSodaxQueryClientOptions = {}): QueryClient {
  if (config?.mutationCache) {
    // Compose: keep the consumer's cache, attach our observability as an extra subscriber.
    // The consumer's own `MutationCache.onError` (if any) still fires — subscribe is additive.
    config.mutationCache.subscribe(event => {
      if (
        event.type === 'updated' &&
        event.action.type === 'error' &&
        event.mutation.options.meta?.silent !== true
      ) {
        onMutationError(event.action.error);
      }
    });
    return new QueryClient(config);
  }

  // No consumer cache: install our own with `onError` directly (cheaper than a subscribe loop).
  return new QueryClient({
    ...config,
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (mutation.options.meta?.silent === true) return;
        onMutationError(error);
      },
    }),
  });
}
