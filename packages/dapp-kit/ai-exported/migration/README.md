# Migration — `@sodax/dapp-kit` v1 → v2

This tree is the v1 → v2 migration playbook for **existing consumers** using v1 dapp-kit. If you're starting fresh on v2 with no v1 code to port, skip to [`../integration/README.md`](../integration/README.md).

## What v2 changes (the 30-second version)

v2 was a deep canonicalization of dapp-kit's hook shapes plus an architectural reshape underneath in `@sodax/sdk`. Five orthogonal changes account for ~95% of the breakage your typecheck will surface:

1. **Single-object hook params.** Every hook accepts a single optional object. Mutation hooks take only `{ mutationOptions }` at hook-init; ALL domain inputs (`params`, `walletProvider`, per-call config) flow through `mutate(vars)`. Query hooks take `{ params, queryOptions }`. v1's positional args and hook-level `spokeProvider` / `params` are gone.
2. **`Result<T>` semantics inverted.** v1: `mutationFn` returned `Result<T>` as success; consumer branched on `data.ok` inside `onSuccess`. v2: `mutationFn` calls `unwrapResult` and **throws** on `!ok` — React Query's native `isError` / `error` / `onError` / `retry` engage. New `mutateAsyncSafe(vars): Promise<Result<TData>>` re-packs the throw for `Result<T>`-style branching when you want it.
3. **`useSpokeProvider` deleted.** Pass `walletProvider` (from `useWalletProvider({ xChainId: chainKey })`) directly into `mutate(vars)`. There is no provider class to derive.
4. **Approve-hook return shape standardized.** v1's `useFooApprove(spokeProvider)` returned a custom `{ approve, isLoading, error }` object. v2 returns the standard `SafeUseMutationResult` with `mutateAsync` / `mutateAsyncSafe` / `isPending`.
5. **Hook-owned invalidations.** Each mutation hook invalidates the relevant query keys in its own `onSuccess`. v1 utilities like `invalidateMmQueries` are deleted; consumer-provided `onSuccess` runs after the hook's invalidations.

The remainder is per-feature shape diffs (return types, params field renames, new required params) and SDK-leakage (`xChainId` → `chainKey`, `*_MAINNET_CHAIN_ID` → `ChainKeys.*`, `Result<T>` propagation through hook signatures).

## Reading order

Read in this order. Each step builds on the last.

1. **[`ai-rules.md`](ai-rules.md)** — DO / DO NOT / workflow / stop-conditions. Read first, then dive in.
2. **This file.** Cross-cutting glossary below + reference list of breaking-changes / features / checklist.
3. **[`checklist.md`](checklist.md)** — top-down cross-cutting migration checklist. Walk it, mark items off as you go.
4. **[`breaking-changes/hook-signatures.md`](breaking-changes/hook-signatures.md)** — fix every hook call site shape first (single-object params, `mutate(vars)`, approve return).
5. **[`breaking-changes/result-handling.md`](breaking-changes/result-handling.md)** — convert SDK-level error handling: success-path branching → `mutateAsyncSafe` (or `try/catch` on `mutateAsync`).
6. **[`breaking-changes/querykey-conventions.md`](breaking-changes/querykey-conventions.md)** — rename consumer query keys to match v2 conventions (where consumer code grafts onto dapp-kit cache invalidation).
7. **[`breaking-changes/sdk-leakage.md`](breaking-changes/sdk-leakage.md)** — SDK-level changes leaking through dapp-kit hook signatures. Cross-links to the SDK's migration tree.
8. **[`features/<x>.md`](features/)** — port the call sites for each feature you use. Pair with [`../integration/features/<x>.md`](../integration/features/) (same filename) when you need v2 design context.
9. **[`recipes.md`](recipes.md)** — codemods and adapters for incremental migration.

## v1 ↔ v2 glossary (terms that changed meaning)

Same word, different concept across versions. Skim before reading the breaking-changes files — this dictionary prevents the most common porting confusions.

| Term | v1 meaning | v2 meaning |
|---|---|---|
| **mutation hook arg** | Positional or first-arg `spokeProvider`; mutation called with minimal vars. | Optional `{ mutationOptions }` only. ALL domain inputs (`params`, `walletProvider`, per-call config) flow through `mutate(vars)`. |
| **query hook arg** | Positional args (e.g. `useGetBridgeableTokens(srcChainId, dstChainId, addr)`). | Single object `{ params, queryOptions }`. |
| **mutation `data`** | `Result<T>` — `{ ok: true; value: T } \| { ok: false; error }`. Branch on `data.ok` in `onSuccess`. | The unwrapped success type `T`. SDK failures throw inside `mutationFn` so React Query's `isError` / `error` engage. |
| **approve hook return** | Custom object: `{ approve, isLoading, error }`. | Standard `SafeUseMutationResult`: `mutateAsync` / `mutateAsyncSafe`, `isPending`, `isError`, `error`. |
| **`useSpokeProvider`** | Hook that derived a `SpokeProvider` from connected wallet state. | Deleted. Pass `walletProvider` (from `useWalletProvider`) directly into `mutate(vars)`. |
| **invalidations** | Consumer-managed via `invalidateMmQueries(queryClient, ...)` utilities. | Hook-owned in composed `onSuccess`. Consumer `onSuccess` runs after the hook's. |
| **`xChainId` / `srcChainId` / `dstChainId`** | Field names on tokens, intents, bridge params. (SDK-leakage.) | Renamed: `XToken.chainKey`, request-side `srcChainKey` / `dstChainKey`. **`Intent.srcChain` / `Intent.dstChain` (read shape) kept** — distinct from request-side. |
| **`*_MAINNET_CHAIN_ID` constants** | Individual exports (`BSC_MAINNET_CHAIN_ID`, etc.). | Gone. Use `ChainKeys.X_MAINNET` namespace access. |
| **`SodaxProvider`'s config** | Flat `rpcConfig: { sonic: '...', ... }`. | Nested under `chains`: `config.chains[ChainKeys.X]: { rpcUrl: '...' }`. |
| **`useMigrate(spokeProvider)`** | Single hook (commented out in v1). | Six per-action hooks: `useMigrateIcxToSoda`, `useRevertMigrateSodaToIcx`, `useMigratebnUSD`, `useMigrateBaln`, `useMigrationApprove`, `useMigrationAllowance`. |
| **error class** | Per-feature classes (`MoneyMarketError<Code>`, `IntentError<Code>`, etc.). (SDK-leakage.) | One canonical `SodaxError<C>` with `feature` + closed 13-code reason vocabulary. |

## Cross-references to integration

Every breaking-change file in this tree has a v2-design counterpart in `../integration/`. Follow the link when "what does v2 expect instead?" comes up:

- [`breaking-changes/hook-signatures.md`](breaking-changes/hook-signatures.md) ↔ [`../integration/architecture.md`](../integration/architecture.md) (§ Read hook shape, Mutation hook shape).
- [`breaking-changes/result-handling.md`](breaking-changes/result-handling.md) ↔ [`../integration/recipes/mutation-error-handling.md`](../integration/recipes/mutation-error-handling.md).
- [`breaking-changes/querykey-conventions.md`](breaking-changes/querykey-conventions.md) ↔ [`../integration/reference/querykey-conventions.md`](../integration/reference/querykey-conventions.md).
- [`breaking-changes/sdk-leakage.md`](breaking-changes/sdk-leakage.md) ↔ [`../../../sdk/ai-exported/migration/`](../../../sdk/ai-exported/migration/) (the underlying SDK's migration tree).
- [`features/<x>.md`](features/) ↔ [`../integration/features/<x>.md`](../integration/features/) (same filename).
- [`recipes.md`](recipes.md) ↔ no integration counterpart (migration-only patterns).

The pair-completeness rule: every file in `migration/features/` has a sibling in `integration/features/` with the same filename. Use this when you're stuck in one and want the other view.
