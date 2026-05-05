# packages/dapp-kit

High-level React hooks library for dApp developers. Wraps `@sodax/sdk` with React Query into feature-organized hooks. Used side-by-side with `@sodax/wallet-sdk-react` (no direct dependency — shared contract types come from `@sodax/sdk`, which re-exports `@sodax/types`).

## Architecture

### Overview (60-second TLDR)

Five architectural pieces hold the canonical hook shape together. Read this section first, then jump to the detailed section for whichever piece you're touching.

- **Two canonical hook shapes.** Read hooks accept `{ params, queryOptions }` typed via `ReadHookParams<TData, TParams>`. Mutation hooks accept `{ mutationOptions }` typed via `MutationHookParams<TData, TVars>` and return `SafeUseMutationResult<TData, Error, TVars>`. All domain inputs (params, walletProvider, apiConfig) flow through `mutate(vars)`, never the hook arg. → see *Read hook shape* and *Mutation hook shape*.
- **`useSafeMutation` foundation.** Every mutation hook calls `useSafeMutation(...)` (drop-in for React Query's `useMutation`) which augments the result with a `mutateAsyncSafe` method that returns `Promise<Result<TData>>` and never rejects. Lives at [src/hooks/shared/useSafeMutation.ts](src/hooks/shared/useSafeMutation.ts). → see *Mutation hook shape* and *Choosing `mutate` / `mutateAsync` / `mutateAsyncSafe`*.
- **`unwrapResult` translation.** SDK service methods return `Result<T>`; `unwrapResult` ([src/hooks/shared/unwrapResult.ts](src/hooks/shared/unwrapResult.ts)) converts that to thrown errors inside `mutationFn` so React Query's native error model (`isError`, `error`, `onError`, `retry`, devtools) engages for SDK failures. → see *SDK Result handling*.
- **`createSodaxQueryClient`** (optional). Factory that returns a `QueryClient` with a `MutationCache.onError` hook giving consumers a single observability seam for mutation failures, plus a `meta.silent` per-mutation opt-out. → see *Provider*.
- **Mechanical enforcement via [_mutationContract.test.ts](src/hooks/_mutationContract.test.ts).** 41 hooks × 6 assertions (242 contract tests) run on every `pnpm test` and lock the canonical shape: `useSafeMutation` not `useMutation`, default `mutationKey` before the spread, `mutationFn` after, `unwrapResult` translation, feature-prefix queryKey rule. Adding a new mutation hook requires registering it in the manifest. → see *Adding a New Hook*.

### Provider

`SodaxProvider` (`src/providers/SodaxProvider.tsx`) wraps the app and provides:
- `Sodax` SDK instance
- Testnet/mainnet flag
- RPC configuration for all chains

Accessed via `useSodaxContext()` hook — all other hooks use this internally.

**Recommended provider stack ordering:**

```tsx
<QueryClientProvider client={queryClient}>     {/* prefer createSodaxQueryClient() */}
  <SodaxProvider config={sodaxConfig}>          {/* SDK instance + RPC config */}
    <SodaxWalletProvider config={walletConfig}> {/* from @sodax/wallet-sdk-react */}
      <YourApp />
    </SodaxWalletProvider>
  </SodaxProvider>
</QueryClientProvider>
```

`SodaxProvider` does NOT depend on `@sodax/wallet-sdk-react` — wallet state is wired side-by-side. See *Decoupling from wallet-sdk-react* below.

#### `createSodaxQueryClient` (optional)

`createSodaxQueryClient` (`src/providers/createSodaxQueryClient.ts`) returns a `QueryClient` pre-wired with a `MutationCache.onError` hook that gives consumers a single observability seam for every mutation failure across the app. Optional opt-in — if you construct your own `QueryClient`, nothing changes.

```tsx
import { createSodaxQueryClient } from '@sodax/dapp-kit';

// Default: logs every mutation failure to console as `[sodax] Mutation error: <error>`
const queryClient = createSodaxQueryClient();

// Wire to your own logger
const queryClient = createSodaxQueryClient({
  onMutationError: (e) => Sentry.captureException(e),
});

// Disable the default entirely (e.g. you wire per-hook onError + an error boundary)
const queryClient = createSodaxQueryClient({ onMutationError: () => {} });
```

**This is observability, not prevention.** It does NOT detect "unhandled" rejections — it fires for *every* mutation failure regardless of whether the consumer caught the rejection, branched on `mutateAsyncSafe`'s `Result.ok`, or registered a per-hook `onError`. To prevent unhandled rejections, use `mutateAsyncSafe` (exposed by every dapp-kit mutation hook).

**Per-mutation opt-out via `meta.silent`.** Consumers who handle a specific mutation locally (e.g. their own toast in `onError`) and don't want a duplicated `[sodax] Mutation error:` log can pass `meta: { silent: true }`:

```tsx
const swap = useSwap({
  mutationOptions: {
    meta: { silent: true },
    onError: (e) => toast.error(e.message),
  },
});
```

**Bring-your-own `MutationCache`.** If you pass `config.mutationCache`, the factory keeps your cache instance (preserving any `onError` you set on it) and *additionally* subscribes to its event stream to dispatch `onMutationError`. Both handlers fire — neither replaces the other. `meta.silent` is honored in both branches.

```tsx
import { MutationCache } from '@tanstack/react-query';
import { createSodaxQueryClient } from '@sodax/dapp-kit';

const myCache = new MutationCache({ onError: myOwnErrorHandler });
const queryClient = createSodaxQueryClient({ config: { mutationCache: myCache } });
// myOwnErrorHandler runs; sodax onMutationError ALSO runs (unless meta.silent).
```

### Hook Organization

~95 hooks (41 mutations + ~50 queries + utilities) organized by feature domain in `src/hooks/`:

```
hooks/
├── shared/     # useSodaxContext, useSafeMutation, unwrapResult, useEstimateGas,
│               # useDeriveUserWalletAddress, useGetUserHubWalletAddress, useXBalances,
│               # useStellarTrustlineCheck, useRequestTrustline
├── provider/   # useHubProvider, useSpokeProvider
├── swap/       # useQuote, useSwap, useStatus, useSwapAllowance, useSwapApprove, useCancelSwap,
│               # useCreateLimitOrder, useCancelLimitOrder
├── mm/         # useSupply, useWithdraw, useBorrow, useRepay, useMMAllowance, useMMApprove,
│               # reserves data hooks (13 hooks total)
├── bridge/     # useBridge, useBridgeAllowance, useBridgeApprove, bridgeable amounts/tokens
├── staking/    # useStake, useUnstake, useInstantUnstake, useClaim, staking info/config hooks
│               # (~18 hooks)
├── dex/        # usePools, useDexDeposit, useDexWithdraw, liquidity supply/decrease, position info
│               # (~13 hooks)
├── bitcoin/    # useBitcoinBalance, Radfi auth/session/trading wallet hooks (~8 hooks)
├── backend/    # Intent tracking, swap submission, orderbook, money market position queries
│               # (~13 hooks)
├── partner/    # Partner fee claim, auto-swap preferences, token approval (6 hooks)
├── recovery/   # useHubAssetBalances, useWithdrawHubAsset
└── migrate/    # useMigrateIcxToSoda, useRevertMigrateSodaToIcx, useMigratebnUSD,
                # useMigrateBaln, useMigrationApprove, useMigrationAllowance
```

Every mutation hook returns `SafeUseMutationResult` (extends `UseMutationResult` with `mutateAsyncSafe`). The 41-hook contract is enforced by [_mutationContract.test.ts](src/hooks/_mutationContract.test.ts).

### React Query Patterns

All hooks follow consistent patterns:

**Query hooks** (data fetching):
- Hierarchical query keys: `['feature', 'action', ...params]`
- `enabled` flag gates on required params being present
- Feature-specific refetch intervals (quotes: 3s, intents: 1s, reserves: 5s, pools: never)

**Mutation hooks** (state changes):
- Wrap SDK service methods
- Invalidate related queries on success via `queryClient.invalidateQueries()`
- Return `SafeUseMutationResult` (extends React Query's `UseMutationResult` with `mutateAsyncSafe`) for loading/error states
- See **Mutation hook shape** below for the canonical structural type

**Smart logic examples:**
- `useMMAllowance` skips on-chain checks for borrow/withdraw (never need approval)
- `useBackendIntentByTxHash` polls at 1s only when a txHash is provided

### Query key conventions (MANDATORY)

Every `queryKey` and `mutationKey` follows the same structural rule. Enforced by [_mutationContract.test.ts](src/hooks/_mutationContract.test.ts) for mutation keys; reviewers enforce it for query keys.

**Rule 1 — first segment is the feature directory name.** No exceptions.

| Hook directory | First segment |
|---|---|
| `backend/` | `'backend'` |
| `bitcoin/` | `'bitcoin'` |
| `bridge/` | `'bridge'` |
| `dex/` | `'dex'` |
| `mm/` | `'mm'` |
| `partner/` | `'partner'` |
| `recovery/` | `'recovery'` |
| `shared/` | `'shared'` |
| `staking/` | `'staking'` |
| `swap/` | `'swap'` |

**Rule 2 — camelCase for all segments.** No kebab-case (`'btc-balance'`), no ad-hoc casing. Identifiers are camelCase string literals (`'tradingWalletBalance'`, `'submitSwapTx'`).

**Rule 3 — shape is `[feature, action, ...identifiers]`** in stable order: chain → token/asset → user → amount. Example: `['mm', 'allowance', srcChainKey, token, action]`.

**Rule 4 — bigints stringify** via `.toString()` before going into a key (React Query's hash uses `JSON.stringify`, which throws on raw bigints). Exception: query keys that pass bigint *via the read hook's typed params* and the corresponding invalidations use the same raw value — match the read hook's shape exactly. New code should always stringify.

**Rule 5 — invalidate the narrowest key that could change.** If the mutation knows the affected `tokenId` / user / chain, scope the invalidation to it. Bare keys (no segments past the action) are reserved for "we don't know which variant changed" cases (e.g. minting a new position with an unknown tokenId) and should be commented.

Worked examples:

```ts
// Read hook
queryKey: ['mm', 'userReservesData', spokeChainKey, userAddress]

// Allowance read (cross-feature pattern — same shape across mm/swap/bridge/dex/staking)
queryKey: ['mm', 'allowance', srcChainKey, token, action]

// Cross-cutting balance lookup
queryKey: ['shared', 'xBalances', xChainId, tokens, address]

// Mutation default key
mutationKey: ['mm', 'supply']

// Scoped invalidation (mutation knows tokenId)
queryClient.invalidateQueries({ queryKey: ['dex', 'positionInfo', tokenId, poolKey] });

// Broad invalidation (acceptable when the mutation can't scope further)
queryClient.invalidateQueries({ queryKey: ['swap', 'allowance'] }); // wipe all allowance variants on approve
```

### Read hook shape (MANDATORY for new `useQuery`-backed hooks)

All read-only hooks MUST accept a single object with **exactly two top-level keys**: `params` (SDK-feature-domain inputs — the *what* being fetched) and `queryOptions` (React Query knobs — the *how* the query behaves). The params type MUST be built on `ReadHookParams<TData, TParams>` from `src/hooks/shared/types.ts`.

Rules:

- **Single params object with two top-level keys.** `{ params, queryOptions }`. Nothing else at the top level. Domain inputs are nested inside `params`. No positional args.
- **Use the shared types.** Params type MUST be `ReadHookParams<TData, TParams>`; the `queryOptions` slot is typed as `ReadQueryOptions<TData>` (which is `Omit<UseQueryOptions<TData, Error>, 'queryKey' | 'queryFn' | 'enabled'>`). Do NOT introduce hook-specific ad-hoc `Omit<UseQueryOptions<...>, ...>` types.
- **Hook owns lifecycle.** `queryKey`, `queryFn`, and `enabled` are owned by the hook. `enabled` is derived from required-input presence and is never consumer-overridable.
- **Hierarchical query keys.** `['feature', 'action', ...inputs]`. Stringify bigints with `.toString()`.
- **No-input hooks.** Hooks without domain inputs type their params as `ReadHookParams<TData>` and accept the whole argument as optional, defaulting to `{}` for ergonomic no-arg calls.
- **Generic hooks.** Keep generics on the hook function (e.g. `<K extends SpokeChainKey>`) and use them to constrain `TParams`.
- **Mutation hooks have their own structural shape** — see **Mutation hook shape** below.

Canonical example:

```ts
import type { PoolData, PoolKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UsePoolDataParams = ReadHookParams<PoolData, { poolKey: PoolKey | null }>;

export function usePoolData({ params, queryOptions }: UsePoolDataParams = {}): UseQueryResult<PoolData, Error> {
  const { sodax } = useSodaxContext();
  const poolKey = params?.poolKey ?? null;

  return useQuery<PoolData, Error>({
    queryKey: ['dex', 'poolData', poolKey],
    queryFn: async () => {
      if (!poolKey) throw new Error('Pool key is required');
      const result = await sodax.dex.clService.getPoolData(poolKey, sodax.hubProvider.publicClient);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: poolKey !== null,
    staleTime: 10_000,
    refetchInterval: 30_000,
    ...queryOptions,
  });
}
```

Call site:

```ts
const { data } = usePoolData({ params: { poolKey } });
```

### Mutation hook shape (MANDATORY for new mutation hooks)

All mutation hooks MUST follow the **zero-domain-param** policy: the hook function itself takes a single optional argument with **exactly one top-level key** — `mutationOptions` — and ALL domain inputs (`params`, `walletProvider`, per-call config, etc.) flow through `mutate(vars)` via the typed `TVars` payload. The params type MUST be built on `MutationHookParams<TData, TVars>` from `src/hooks/shared/types.ts` (mirror of `ReadHookParams`).

**Three shared utilities** (all exported from [src/hooks/shared/](src/hooks/shared/)) underpin every mutation hook:

- **`useSafeMutation(options)`** — drop-in for React Query's `useMutation`. Returns `SafeUseMutationResult<TData, Error, TVars>` (extends `UseMutationResult` with `mutateAsyncSafe`). Lives in [shared/useSafeMutation.ts](src/hooks/shared/useSafeMutation.ts).
- **`unwrapResult(result)`** — `Result<T>` → throw `error` on `!ok`, return `value` on `ok`. Use inside `mutationFn` to translate SDK failures into React Query errors. Lives in [shared/unwrapResult.ts](src/hooks/shared/unwrapResult.ts).
- **`toResult(promise)`** — pure helper that catches a `Promise<T>` rejection and packs it into `Result<T>`. Used internally by `useSafeMutation` to build `mutateAsyncSafe`; also exported for unit tests.

Rules:

- **Use `useSafeMutation`, not `useMutation`.** Every dapp-kit mutation hook MUST call `useSafeMutation(...)` from `src/hooks/shared/useSafeMutation.js` instead of React Query's `useMutation`. The wrapper augments the result with `mutateAsyncSafe`, which consumers depend on. Never call `useMutation` directly.
- **One optional top-level arg.** Hook signature: `useFoo({ mutationOptions } = {}): SafeUseMutationResult<TData, Error, TVars>`. Existing zero-arg call sites (`useFoo()`) keep working.
- **Use the shared types.** Hook param type MUST be `MutationHookParams<TData, TVars>`; return type MUST be `SafeUseMutationResult<TData, Error, TVars>`; `mutationOptions` is typed as `MutationHookOptions<TData, TVars>` (which is `Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'>`). Do NOT introduce ad-hoc per-hook option shapes.
- **Hook owns `mutationFn`.** It's the SDK integration point — never consumer-overridable.
- **`mutationFn` throws on SDK `!ok` and returns the unwrapped success value.** Use `unwrapResult` from `src/hooks/shared/unwrapResult.js`. The SDK returns `Result<T>`; the hook unwraps to `T` so React Query's native error model (`isError`, `error`, `onError`, `retry`, `throwOnError`, devtools) engages for SDK failures. `TData` is the unwrapped success type, NOT `Result<T>`. See **SDK Result handling** below.
- **Set a default `mutationKey` BEFORE the spread**, then spread `...mutationOptions`, then define `mutationFn` last. Order matters: the default key is overridable by the consumer (spread wins), but `mutationFn` is hook-owned and must beat the spread.
- **Compose `onSuccess` (and any other callbacks the hook itself defines).** Invalidations are correctness logic owned by the hook. Because they live inside `onSuccess` (not `onSettled`), they fire only on confirmed success — failed mutations never trigger them. After running invalidations, `await mutationOptions?.onSuccess?.(data, vars, ctx)` so consumer hooks still fire. Per-call `mutate(vars, { onSuccess })` runs after both, per TanStack Query's native ordering.
- **Derive invalidation keys from `vars`, not closures.** Use `(data, vars, ctx) => ...` and read `vars.params.srcChainKey` etc. — never close over hook-time params.
- **All domain inputs go in `TVars`.** No `params`, `walletProvider`, `apiConfig`, etc. at the hook level. The hook re-renders if its arg changes; pushing inputs into `mutate(vars)` lets a single hook invocation serve many call shapes without remounting.
- **Generic hooks.** Keep generics on the hook function (e.g. `<K extends SpokeChainKey>`) and use them to constrain `TVars`.

Canonical example — hook with invalidations:

```ts
import type { SwapActionParams, SwapResponse, SpokeChainKey } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseSwapVars<K extends SpokeChainKey = SpokeChainKey> = Omit<SwapActionParams<K, false>, 'raw'>;

export function useSwap<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<SwapResponse, UseSwapVars<K>> = {}): SafeUseMutationResult<
  SwapResponse,
  Error,
  UseSwapVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<SwapResponse, Error, UseSwapVars<K>>({
    mutationKey: ['swap'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.swaps.swap({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['xBalances', vars.params.srcChainKey] });
      queryClient.invalidateQueries({ queryKey: ['xBalances', vars.params.dstChainKey] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
```

Call sites — pick the call shape that fits your flow (see **Choosing `mutate` / `mutateAsync` / `mutateAsyncSafe`** below):

```ts
// Recommended for imperative flows: `mutateAsyncSafe` — never rejects, returns Result<T>
const { mutateAsyncSafe: swap } = useSwap();
const result = await swap({ params, walletProvider });
if (!result.ok) { toast(result.error instanceof Error ? result.error.message : 'Swap failed'); return; }
const { intent, intentDeliveryInfo } = result.value;

// Or `mutateAsync` if you prefer exception flow (MUST wrap in try/catch)
const { mutateAsync: swap } = useSwap();
try {
  const swapResponse = await swap({ params, walletProvider });
} catch (e) {
  // SDK failure or thrown error
}

// With consumer options (retry, onError, mutationKey, etc.) — works for all three call shapes
const swap = useSwap({
  mutationOptions: {
    retry: 5,
    onError: err => toast.error(err.message),  // fires on SDK !ok and on real exceptions
    onSuccess: swapResponse => {
      // Runs AFTER dapp-kit's invalidations — never replaces them.
      trackSwap(swapResponse);
    },
  },
});

// Per-call options (run after both hook-level and consumer-level callbacks)
await swap.mutateAsync({ params, walletProvider }, { onSuccess: () => navigate('/done') });

// Global "any swap in flight?" via the default mutationKey
const swapsInFlight = useIsMutating({ mutationKey: ['swap'] });
```

For hooks without invalidations (e.g. `useEstimateGas`, `useBackendSubmitSwapTx`), drop the composed `onSuccess` — the spread alone suffices:

```ts
return useSafeMutation<TData, Error, TVars>({
  mutationKey: ['shared', 'estimateGas'],
  ...mutationOptions,
  mutationFn: async vars => unwrapResult(await sodax.foo.bar(vars)),
});
```

#### SDK Result handling

Every public SDK service method returns `Result<T> = { ok: true; value: T } | { ok: false; error: Error | unknown }` and never throws (errors are caught and packed into the `Result`). This is the SDK's contract — keep it that way.

dapp-kit mutation hooks **translate that contract into the React Query contract** by throwing `result.error` on `!ok` inside `mutationFn`. The reasons:

- React Query's `isError`, `error`, `onError`, `retry`, `throwOnError`, and devtools all key off `mutationFn` throwing. With `Result<T>` returned as success, none of those engage on SDK failure.
- Consumers had to remember to branch on `data.ok` inside every `onSuccess` to avoid running success logic on a failed swap. Forgetting was easy and silent.
- Hook-owned invalidations (which live in `onSuccess`) used to fire on SDK failure too, burning RPC traffic on every failed click.

After translating, the public hook signature is `SafeUseMutationResult<T, Error, TVars>` (extends `UseMutationResult`) — `data` is the unwrapped success value (e.g. `SwapResponse`, `TxHashPair`), and SDK failures arrive via `mutation.error` exactly like any other thrown error. Call sites pick from three call shapes:

- `mutation.mutate(vars)` for fire-and-forget (errors via `mutation.error` / consumer `onError`).
- `mutation.mutateAsync(vars)` if you want exception flow control (must be inside `try/catch`).
- `mutation.mutateAsyncSafe(vars)` if you want `Result<TData>` ergonomics — never rejects, branch on `.ok`. **This is the recommended path** for imperative flows where the user-reject case is modal, not exceptional. See **Choosing `mutate` / `mutateAsync` / `mutateAsyncSafe`** below.

The dual API means consumers never have to choose between the React Query error model and `Result<T>` ergonomics — both are exposed by the same hook. Calling the SDK directly (`sodax.<feature>.<method>`) is only needed if you're outside React (e.g. a Node.js script, webhook handler).

#### Choosing `mutate` / `mutateAsync` / `mutateAsyncSafe`

Every dapp-kit mutation hook returns three ways to invoke the mutation. Pick by call shape:

| Method | Returns | Rejects? | When to use |
|---|---|---|---|
| `mutate(vars)` | `void` (fire-and-forget) | Never | Button-click handlers where you read `isPending` / `isError` / `error` in render. Consumer-supplied `onError` fires; React Query owns state. |
| `mutateAsync(vars)` | `Promise<TData>` | **Yes** on `!ok` | Imperative chains where you only need the success value. **MUST be inside `try/catch`** or you'll leak unhandled rejections on user-rejects. |
| `mutateAsyncSafe(vars)` | `Promise<Result<TData>>` | **Never** | Imperative chains where you want to branch on success/failure without exception flow. Same React Query state under the hood (`isError`, `error`, devtools all work). |

`mutateAsyncSafe` is the recommended default for sequenced flows like `if (!hasAllowance) await approve(...); await action(...);` — the user-reject case is the modal failure mode in dApps, not exceptional, and `Result<T>`-style branching reads cleaner than exception flow control.

```ts
// fire-and-forget — read state in render
const m = useSwap();
<button onClick={() => m.mutate({ params, walletProvider })}>Swap</button>

// throws — for chains where you want exception flow
const { mutateAsync } = useSwap();
try { const r = await mutateAsync({ params, walletProvider }); /* … */ }
catch (e) { toast(e instanceof Error ? e.message : 'Swap failed'); }

// safe — for chains where you want explicit branching, no try/catch
const { mutateAsyncSafe } = useSwap();
const result = await mutateAsyncSafe({ params, walletProvider });
if (!result.ok) { toast(result.error.message); return; }
const { intent, intentDeliveryInfo } = result.value;
```

### What changed vs `sdk-v2-main`

Migration guide for consumers (or AI agents) who knew the pre-canonical API. Four disruptive shifts; everything else is structural housekeeping.

**1. Throw-on-`!ok` semantic shift.** SDK `Result<T>` failures used to flow through React Query's success path; now they throw inside `mutationFn` so `isError` / `error` / `onError` / `retry` / devtools all engage. Pick `mutateAsyncSafe` (preferred for imperative flows — never rejects, returns `Result<T>`) or wrap `mutateAsync` in `try/catch`.

```ts
// Before — Result<T> returned via React Query success
const result = await mutateAsync({ params, walletProvider });
if (result.ok) { use(result.value); }
else { toast(result.error.message); }

// After (preferred) — mutateAsyncSafe never rejects
const result = await mutateAsyncSafe({ params, walletProvider });
if (!result.ok) { toast(result.error.message); return; }
use(result.value);

// After (alternative) — mutateAsync rejects on !ok
try {
  const value = await mutateAsync({ params, walletProvider });
  use(value);
} catch (e) { toast(e.message); }
```

→ see *SDK Result handling* and *Choosing `mutate` / `mutateAsync` / `mutateAsyncSafe`*.

**2. Approve hooks now return standard `SafeUseMutationResult`.**

```ts
// Before — useSwapApprove / useBridgeApprove returned a custom object
const { approve, isLoading, error } = useSwapApprove(params, chain, walletProvider);

// After — same shape as every other mutation hook
const { mutateAsync: approve, isPending: isApproving } = useSwapApprove();
await approve({ params, walletProvider });
```

**3. Hook param shape — single object with `mutationOptions` / `queryOptions`.**

```ts
// Before — spokeProvider at hook level (mutations) or positional args (queries)
useSwap(spokeProvider);
useSwapAllowance(params, spokeProvider);

// After (mutations) — all domain inputs flow through mutate(vars)
const { mutateAsync: swap } = useSwap({ mutationOptions: { onError } });
await swap({ params, walletProvider });

// After (queries) — { params, queryOptions }
const { data } = useSwapAllowance({ params, queryOptions: { refetchInterval: 5000 } });
```

→ see *Read hook shape* / *Mutation hook shape*.

**4. Canonical queryKey/mutationKey conventions.**

```ts
// Before — ad-hoc first segments, kebab-case in places, no unifying rule
queryKey: ['xBalances', ...]
queryKey: ['btc-balance', ...]
queryKey: ['api', 'mm', ...]
mutationKey: undefined  // many hooks had no default

// After — feature-directory-first, camelCase, every hook has a default mutationKey
queryKey: ['shared', 'xBalances', ...]
queryKey: ['bitcoin', 'balance', ...]
queryKey: ['backend', 'mm', ...]
mutationKey: ['mm', 'supply']  // overridable by consumer via mutationOptions.mutationKey
```

The convention is mechanically enforced by [_mutationContract.test.ts](src/hooks/_mutationContract.test.ts) for mutation keys and reviewer-enforced for query keys. → see *Query key conventions*.

**Side effects worth knowing.** The `migrate/` directory was reactivated with 6 per-action hooks (`useMigrateIcxToSoda`, `useRevertMigrateSodaToIcx`, `useMigratebnUSD`, `useMigrateBaln`, `useMigrationApprove`, `useMigrationAllowance`) replacing the entirely commented-out legacy `useMigrate(spokeProvider)`-style API. Apps consuming the old `useMigrate` need to switch to the per-action hooks.

### Adding a New Hook

Follow the pattern of existing hooks in the same feature domain:
1. Create the hook file in the appropriate `hooks/<feature>/` directory
2. Use `useSodaxContext()` to access the SDK instance
3. For queries: use `useQuery` with appropriate key, enabled condition, and refetch interval. Type params with `ReadHookParams<TData, TParams>` — see **Read hook shape** above.
4. For mutations: use **`useSafeMutation`** (NOT `useMutation` — the safe variant exposes `mutateAsyncSafe` which every dapp-kit consumer expects). Return type MUST be `SafeUseMutationResult<TData, Error, TVars>`. Type the hook arg with `MutationHookParams<TData, TVars>`, push all domain inputs into `TVars`, set a default `mutationKey` before the spread, unwrap SDK `Result<T>` via `unwrapResult` (so the function throws on `!ok`), and compose `onSuccess` invalidations with the consumer's — see **Mutation hook shape** above.
5. Export from the feature's `index.ts` and from `hooks/index.ts`
6. **Mutation hooks only**: append the hook's relative path (e.g. `'mm/useFoo.ts'`) to the `HOOKS` manifest in [_mutationContract.test.ts](src/hooks/_mutationContract.test.ts). The contract test asserts canonical shape compliance — adding a hook without registering it leaves it untested. The friction is intentional: you can't accidentally ship a non-conformant hook. For hooks that wrap natively-throwing SDK methods (no `Result<T>`), set `nativeThrow: true` on the manifest entry to skip the `unwrapResult` assertion.

## Directory Structure

```
src/
├── index.ts              # Barrel export
├── contexts/             # SodaxContext definition
├── providers/            # SodaxProvider component
├── hooks/                # All feature hooks (see above)
└── utils/
    └── dex-utils.ts      # DEX param builders (deposit, withdraw, liquidity calculations)
```

## Dependencies

- `@sodax/sdk` (workspace) — core business logic and shared types (including contract interfaces like `IXService`; the SDK re-exports `@sodax/types` from its public entry)
- `@tanstack/react-query` (peer) — server state management
- `react` (peer, >=18)
- `viem` — Ethereum utilities

## Decoupling from wallet-sdk-react

dapp-kit does **not** depend on `@sodax/wallet-sdk-react`. When a hook needs wallet-layer state (e.g. `useXBalances` needs a balance reader), the consumer injects it as a param typed against a contract interface from `@sodax/sdk` (e.g. `IXService`).

Consumer apps wire both packages side-by-side:

```tsx
import { useXService, getXChainType } from '@sodax/wallet-sdk-react';
import { useXBalances } from '@sodax/dapp-kit';

const xService = useXService({ xChainType: getXChainType(chainId) });
const { data } = useXBalances({ xService, xChainId, xTokens, address });
```

This mirrors the `wallet-sdk-core` ↔ `@sodax/sdk` pattern: wallet-sdk-core implements wallet contracts; `@sodax/sdk` carries domain types consumers import from `@sodax/sdk` (`export * from '@sodax/types'`), without dapp-kit taking a separate `@sodax/types` dependency.

## AI Skills (Scaffolding Guides)

See `skills/SKILLS.md` for AI-agent-friendly guides to scaffold each feature with dapp-kit hooks. Covers setup, wallet connectivity, swap, bridge, money market, staking, migration, DEX, and backend queries. All examples follow the single-object-parameter convention.

## Build

tsup: dual ESM (`.mjs`) + CJS (`.cjs`). React and React Query are externalized (not bundled).
