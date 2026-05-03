import type { UseQueryOptions } from '@tanstack/react-query';

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
