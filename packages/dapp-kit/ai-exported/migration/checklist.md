# Migration checklist — `@sodax/dapp-kit` v1 → v2

Top-down cross-cutting checklist. Walk it in order — each step makes later ones tractable.

## Phase 1 — provider stack and imports

- [ ] **Update `SodaxProvider` config shape.** `rpcConfig: { sonic: '...', ... }` → `chains: { [ChainKeys.SONIC_MAINNET]: { rpcUrl: '...' } }`. See [`breaking-changes/hook-signatures.md`](breaking-changes/hook-signatures.md) § Provider stack.
- [ ] **Replace `new QueryClient()` with `createSodaxQueryClient()`** (optional but recommended — gives you global mutation observability).
- [ ] **Drop any `@sodax/types` dependency** from `package.json`. Re-exported via `@sodax/sdk` (which dapp-kit re-exports). Run `pnpm install` after.
- [ ] **Import statement codemod.**
  - `useSpokeProvider` import → delete the import line.
  - `BSC_MAINNET_CHAIN_ID` (and the 14 other `*_MAINNET_CHAIN_ID` constants) → `ChainKeys.X_MAINNET`.
  - Any deep-import from `@sodax/dapp-kit/dist/...` → import from `@sodax/dapp-kit` root.

## Phase 2 — mechanical sweeps

- [ ] **Delete every `useSpokeProvider(...)` call.** The `walletProvider` from `useWalletProvider({ xChainId: chainKey })` flows directly into `mutate(vars)`. See [`reference/deleted-hooks.md`](reference/deleted-hooks.md).
- [ ] **`*_MAINNET_CHAIN_ID` → `ChainKeys.X_MAINNET`.** Codemod with sed:

   ```bash
   find src -type f \( -name '*.ts' -o -name '*.tsx' \) | xargs sed -i '' -E 's/\b([A-Z_]+)_MAINNET_CHAIN_ID\b/ChainKeys.\1_MAINNET/g'
   ```

- [ ] **`xChainId` → `chainKey` on `XToken`.** Be careful — only on the read shape. The `useXBalances` hook still takes `xChainId` as a request param (intentional naming for the cross-chain abstraction). See [`breaking-changes/sdk-leakage.md`](breaking-changes/sdk-leakage.md).

## Phase 3 — hook-call-site rewrites (per feature)

For each feature your app uses, walk the matching `migration/features/<feature>.md`:

- [ ] [`features/swap.md`](features/swap.md) — swap call sites.
- [ ] [`features/money-market.md`](features/money-market.md) — supply / borrow / withdraw / repay.
- [ ] [`features/staking.md`](features/staking.md) — stake / unstake / claim.
- [ ] [`features/bridge.md`](features/bridge.md) — bridge.
- [ ] [`features/dex.md`](features/dex.md) — deposit / supply liquidity / etc.
- [ ] [`features/migration.md`](features/migration.md) — ICX / bnUSD / BALN. **Note:** v1's `useMigrate(spokeProvider)` is gone; v2 has 6 per-action hooks.
- [ ] [`features/bitcoin.md`](features/bitcoin.md) — Radfi.
- [ ] [`features/auxiliary-services.md`](features/auxiliary-services.md) — partner, recovery, backend queries, shared utilities.

The cross-cutting pattern at every call site:

1. **Hook init**: `useFoo(spokeProvider, params)` → `useFoo()` or `useFoo({ mutationOptions })`. No domain inputs at hook init.
2. **Mutation invocation**: `mutate(spokeProvider)` or `mutate()` → `mutate({ params, walletProvider })`. ALL domain inputs flow through here.
3. **Approve hooks**: `const { approve, isLoading } = useFooApprove(spokeProvider)` → `const { mutateAsync: approve, isPending } = useFooApprove()`.
4. **Query hooks**: `useFoo(arg1, arg2)` → `useFoo({ params: { ... }, queryOptions: { ... } })`.

## Phase 4 — Result<T> handling

- [ ] **Mutation success-path branching.** v1: `onSuccess: (data) => { if (data.ok) ... }`. v2: drop the `.ok` check; `data` is unwrapped success (e.g. `SwapResponse`, `TxHashPair`).
- [ ] **Convert imperative `mutateAsync` calls.** Wrap in `try/catch` (v2 throws on `!ok`) OR switch to `mutateAsyncSafe` and branch on `result.ok`. See [`breaking-changes/result-handling.md`](breaking-changes/result-handling.md).
- [ ] **Audit `onError` callbacks.** They now fire for SDK `!ok` (didn't in v1). Check that any error-toast logic is appropriate.

## Phase 5 — invalidations

- [ ] **Delete `invalidate*Queries` utility files.** Hook-owned in v2; no consumer-side invalidation needed.
- [ ] **Drop manual `queryClient.invalidateQueries(...)` calls** that mirror what dapp-kit hooks already do (e.g. `xBalances` after a swap).
- [ ] **Keep ONLY the cross-feature invalidations** that dapp-kit hooks don't know about (e.g. your custom analytics view query).
- [ ] **If you have consumer wrappers around dapp-kit mutations**, ensure they don't double-invalidate. Move custom invalidations to the wrapper's `mutationOptions.onSuccess`.

## Phase 6 — queryKey alignment (optional but recommended)

If your code grafts onto dapp-kit's cache invalidation (e.g. you fetch a related query and want it to be invalidated by dapp-kit's mutation), align your queryKeys with dapp-kit conventions:

- [ ] **First segment = feature directory name.** `'swap'`, `'mm'`, `'bridge'`, etc. See [`../integration/reference/querykey-conventions.md`](../integration/reference/querykey-conventions.md).
- [ ] **camelCase segments.** No kebab-case.
- [ ] **Bigints stringified** in keys.

## Phase 7 — SDK-level migrations leaking through

These are SDK-level changes that surface in dapp-kit hook signatures or types. Refer to the SDK migration tree for full detail:

- [ ] **Chain-key terminology** — `xChainId` / `srcChainId` / `dstChainId` on action params → `chainKey` / `srcChainKey` / `dstChainKey`. See [`../../../sdk/ai-exported/migration/breaking-changes/type-system.md`](../../../sdk/ai-exported/migration/breaking-changes/type-system.md).
- [ ] **SodaxConfig reshape** — flat `rpcConfig` → nested `chains[ChainKeys.X]: { rpcUrl }`. See [`../../../sdk/ai-exported/migration/breaking-changes/architecture.md`](../../../sdk/ai-exported/migration/breaking-changes/architecture.md).
- [ ] **Error class** — `MoneyMarketError<Code>` etc. → single `SodaxError<C>`. See [`../../../sdk/ai-exported/migration/breaking-changes/result-and-errors.md`](../../../sdk/ai-exported/migration/breaking-changes/result-and-errors.md). dapp-kit consumers see this only if they directly reference SDK error classes.

## Phase 8 — verification

- [ ] `pnpm tsc --noEmit` is clean.
- [ ] Smoke-test each feature your app uses: connect wallet, run one mutation, observe success + state updates.
- [ ] Search for v1 leftovers: `grep -rE '\buseSpokeProvider\b|\binvalidateMmQueries\b|_MAINNET_CHAIN_ID\b'` returns zero hits.
- [ ] Confirm `mutateAsync` calls are wrapped in `try/catch` OR replaced with `mutateAsyncSafe`.
- [ ] Confirm provider stack uses `chains: ...` not `rpcConfig: ...`.

## Cross-references

- [`README.md`](README.md) — overview and v1↔v2 glossary.
- [`ai-rules.md`](ai-rules.md) — DO / DO NOT for the agent doing the migration.
- [`breaking-changes/`](breaking-changes/) — cross-cutting v1→v2 deltas (hook signatures, result handling, queryKey, SDK leakage).
- [`recipes.md`](recipes.md) — codemods and adapters.
- [`features/`](features/) — per-feature porting playbooks.
