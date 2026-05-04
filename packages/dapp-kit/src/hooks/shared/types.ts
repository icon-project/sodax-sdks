// packages/dapp-kit/src/hooks/shared/types.ts
import type { UseMutationOptions, UseQueryOptions } from '@tanstack/react-query';

/**
 * Subset of `UseQueryOptions` consumers may override on dapp-kit read hooks.
 *
 * `queryKey`, `queryFn`, and `enabled` are owned by the hook (the latter is derived
 * from required-input presence) and are intentionally stripped here.
 */
export type ReadQueryOptions<TData, TError = Error> = Omit<
  UseQueryOptions<TData, TError>,
  'queryKey' | 'queryFn' | 'enabled'
>;

/**
 * Canonical params shape for read-only `useQuery`-backed hooks in dapp-kit.
 *
 * Two top-level keys, always:
 * - `params`: SDK-feature-domain inputs (the "what" being fetched)
 * - `queryOptions`: React Query behavior knobs (the "how" the query behaves)
 *
 * For hooks with no required inputs, leave `TParams` at its default and accept the
 * whole params object as optional at the call site.
 */
export type ReadHookParams<TData, TParams = Record<string, never>, TError = Error> = {
  params?: TParams;
  queryOptions?: ReadQueryOptions<TData, TError>;
};

/**
 * Subset of `UseMutationOptions` consumers may override on dapp-kit mutation hooks.
 *
 * `mutationFn` is owned by the hook (it's the SDK integration point) and is
 * intentionally stripped here. Everything else — `mutationKey`, `retry`, `gcTime`,
 * `networkMode`, `onMutate`, `onSuccess`, `onError`, `onSettled`, `meta`, etc. —
 * is consumer-overridable.
 *
 * Conventions enforced by every dapp-kit mutation hook:
 *
 * 1. **`mutationFn` throws on SDK failure.** The SDK returns `Result<T>`; the hook
 *    unwraps `result.value` on `ok` and throws `result.error` on `!ok`. So `TData`
 *    here is the unwrapped success type, not `Result<T>`. React Query's native
 *    error model — `isError`, `error`, `onError`, `retry`, `throwOnError`, devtools —
 *    works exactly as documented.
 *
 * 2. **`onSuccess` is composed.** Hook-owned invalidations always run first; then
 *    the hook awaits `mutationOptions?.onSuccess?.(data, vars, ctx)`. Per-call
 *    `mutate(vars, { onSuccess })` runs after both, per TanStack Query's native
 *    ordering. Because invalidations now live inside `onSuccess` (not `onSettled`),
 *    they only fire on confirmed success — failed mutations never trigger them.
 *
 * 3. **A default `mutationKey` is set per hook** (e.g. `['mm', 'supply']`,
 *    `['swap']`) so consumers can use `useIsMutating(['mm'])` and
 *    `useMutationState` without guessing the key shape. The default is set
 *    *before* `...mutationOptions` is spread, so consumers can override it.
 */
export type MutationHookOptions<TData, TVars, TError = Error, TContext = unknown> = Omit<
  UseMutationOptions<TData, TError, TVars, TContext>,
  'mutationFn'
>;

/**
 * Canonical params shape for `useMutation`-backed hooks in dapp-kit.
 *
 * One top-level key:
 * - `mutationOptions`: React Query behavior knobs (the "how" the mutation behaves)
 *
 * Domain inputs (params, walletProvider, etc.) are NOT here — they belong in
 * `TVars` and flow through `mutate(vars)` so the call site can vary them per
 * invocation without re-rendering the hook.
 *
 * Always accept the whole params object as optional at the call site:
 * `useFoo({ mutationOptions } = {})`.
 */
export type MutationHookParams<TData, TVars, TError = Error, TContext = unknown> = {
  mutationOptions?: MutationHookOptions<TData, TVars, TError, TContext>;
};
