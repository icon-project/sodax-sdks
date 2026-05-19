---
name: sodax-dapp-kit-integration
description: 'Build NEW code with `@sodax/dapp-kit` — React hooks wrapping `@sodax/sdk` with React Query across 11 feature domains (swap, money market, staking, bridge, dex, migration, partner, recovery, bitcoin/Radfi, backend queries, shared). React-only — Node and backend code uses `@sodax/sdk` directly. Use whenever a React dapp needs SODAX feature hooks. Triggers on "use @sodax/dapp-kit", "useSwap", "useMoneyMarket", "useStake", "useBridge", "useDex", "useMigrate", any `use<Feature>` hook name from dapp-kit, "Sodax React hooks", "dapp-kit query / mutation". v2 hook shape: mutation hooks return `SafeUseMutationResult` with `mutateAsyncSafe(vars): Promise<Result<TData>>`. mutationFn unwraps SDK Result<T> and throws on `!ok` so React Query''s native error model engages. Hook-owned invalidations — consumer onSuccess runs after.'
---

# When to use this skill

Pick this skill when the consumer is a React dapp using `@sodax/dapp-kit` hooks. Common signals:

- Any feature hook: `useSwap`, `useMoneyMarket*`, `useStake`, `useBridge`, `useDex*`, `useMigrate*`, `useRadfi*`, `usePartner*`, `useRecovery*`.
- "Wire React Query for SODAX" — `SodaxProvider`, `createSodaxQueryClient`.
- "Branch on mutation result without try/catch" — `mutateAsyncSafe`.
- "Custom invalidation on success" — consumer-provided `onSuccess` (note: hook-owned invalidations already run; yours runs *after*).

For backend / Node → use `sodax-sdk-integration` (dapp-kit is React-only).

For porting v1 dapp-kit code → use `sodax-dapp-kit-migration` first.

Also load `sodax-wallet-sdk-react-integration` — every dapp-kit consumer needs wallet connectivity.

# Workflow

1. Read [`../../knowledge/dapp-kit/integration/ai-rules.md`](../../knowledge/dapp-kit/integration/ai-rules.md) — DO / DO NOT / workflow / stop conditions.
2. Read [`../../knowledge/dapp-kit/integration/quickstart.md`](../../knowledge/dapp-kit/integration/quickstart.md) — install + wire providers + first feature.
3. Read [`../../knowledge/dapp-kit/integration/architecture.md`](../../knowledge/dapp-kit/integration/architecture.md) — hook shapes, queryKey conventions, `useSafeMutation`, `unwrapResult`, `Result<T>`.
4. For each feature you use, read [`../../knowledge/dapp-kit/integration/features/`](../../knowledge/dapp-kit/integration/features/) — `swap.md`, `money-market.md`, `staking.md`, `bridge.md`, `dex.md`, `migration.md`, `bitcoin.md` (Radfi, dapp-kit-unique), `auxiliary-services.md` (partner + recovery + backend + shared).
5. Recipes → [`../../knowledge/dapp-kit/integration/recipes/`](../../knowledge/dapp-kit/integration/recipes/) — `setup.md`, `wallet-connectivity.md`, per-feature, `mutation-error-handling.md`, `observability.md`, `invalidations.md`.
6. Lookups → [`../../knowledge/dapp-kit/integration/reference/`](../../knowledge/dapp-kit/integration/reference/) — `hooks-index.md`, `querykey-conventions.md`, `public-api.md`, `glossary.md`.

# v2 in one minute

1. **Hooks accept a single object with one or two top-level keys.** Mutation hooks take only `{ mutationOptions }` at hook-init; query hooks take `{ params, queryOptions }`. ALL domain inputs (`params`, `walletProvider`, per-call config) flow through `mutate(vars)` for mutations.
2. **Every mutation hook returns `SafeUseMutationResult`** — extends React Query's `UseMutationResult` with `mutateAsyncSafe(vars): Promise<Result<TData>>` (never rejects). Use `mutateAsyncSafe` for sequenced flows; `mutateAsync` for try/catch flows; `mutate` for fire-and-forget render-driven flows.
3. **`mutationFn` throws on SDK `!ok`.** dapp-kit calls `unwrapResult` on the SDK's `Result<T>`, throwing on failure. This makes React Query's native error model engage (`isError`, `error`, `onError`, `retry`, devtools). `mutateAsyncSafe` packages the throw back into `Result<T>` for ergonomic branching.
4. **Hook-owned invalidations.** Each mutation hook invalidates the relevant query keys in its `onSuccess`, derived from `vars`. Consumer-provided `onSuccess` runs after. v1's manual `invalidateMmQueries` utilities are gone.
5. **Canonical queryKey shape.** `[feature, action, ...identifiers]`. First segment matches the directory name (`swap`, `mm`, `bridge`, `staking`, `dex`, `bitcoin`, `partner`, `recovery`, `backend`, `shared`, `migrate`). camelCase. Bigints stringified.

# Conventions agents must follow

- **Use dapp-kit's exported hooks.** Don't wrap with React Query's `useMutation` directly — consumers depend on `mutateAsyncSafe`.
- **Branch on `mutateAsyncSafe`'s `Result.ok` for sequenced flows.** The user-reject case is modal, not exceptional.
- **`ChainKeys.*` over hard-coded chain strings.** The set evolves per release.
- **Drop `spokeProvider`.** It's not a v2 concept. `walletProvider` flows through `mutate(vars)` for signed flows.
- **Don't recreate hook-owned invalidations.** Each mutation hook already invalidates the relevant keys; consumer `onSuccess` runs after for any extra logic.
- Import only from the package root: `import { useSwap, SodaxProvider, createSodaxQueryClient } from '@sodax/dapp-kit'`. dapp-kit re-exports `@sodax/sdk`'s public surface (`ChainKeys`, `SodaxConfig`, types) — you can import them from dapp-kit directly.
- Don't add `@sodax/types` as a dependency — re-exported via `@sodax/sdk`.

# Top traps to avoid

1. **Reaching for `useSpokeProvider`.** Deleted. Pass `walletProvider` from `useWalletProvider({ xChainId: chainKey })` (`@sodax/wallet-sdk-react`) directly into `mutate(vars)`.
2. **Treating mutation `data` as `Result<T>`.** v2's `mutationFn` unwraps before resolving — `data` is the unwrapped success value (e.g. `SwapResponse`, `TxHashPair`). For SDK failures, look at `mutation.error` or use `mutateAsyncSafe` for the `Result<T>` shape.
3. **Forgetting `try/catch` on `mutateAsync`.** v2's `mutateAsync` rejects on SDK `!ok`. Prefer `mutateAsyncSafe` (never rejects).
4. **Hook-level `spokeProvider` / `params`.** v1 hooks took these positionally or at hook-init. v2 hooks take only `{ mutationOptions }` (mutations) or `{ params, queryOptions }` (queries). All domain inputs live in `mutate(vars)` for mutations.
5. **Reading `xToken.xChainId` or hard-coding `*_MAINNET_CHAIN_ID`.** SDK leakage — these were renamed: `XToken.chainKey`, `ChainKeys.X_MAINNET`.

# Verification

```bash
pnpm tsc --noEmit   # must exit clean
```

In browser:
- Successful mutations populate `data` with the unwrapped success value.
- SDK `!ok` errors arrive via `mutation.error` (when using `mutate` / `mutateAsync`) or as `result.ok === false` (when using `mutateAsyncSafe`).
- React Query devtools show hook-owned invalidations firing on success.

# Related skills

- `sodax-dapp-kit-migration` — port v1 dapp-kit code (deleted `useSpokeProvider`, renamed hooks, new error model).
- `sodax-wallet-sdk-react-integration` — wire the wallet, get the `walletProvider` to feed into dapp-kit `mutate(vars)`.
- `sodax-sdk-integration` — for any direct SDK call alongside dapp-kit hooks.
