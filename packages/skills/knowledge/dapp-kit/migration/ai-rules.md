# AI rules — `@sodax/dapp-kit` migration v1 → v2

DO / DO NOT / workflow / stop conditions for AI agents porting v1 dapp-kit code to v2. Read this **before** the per-feature migration playbooks.

## Workflow (do these in order)

1. **Survey the v1 surface area first.**

   ```bash
   pnpm tsc --noEmit                                                          # baseline (will produce hundreds of errors)
   grep -rE '\buseSpokeProvider\b|\binvalidateMmQueries\b' --include='*.tsx' --include='*.ts' src/   # hottest v1 patterns
   grep -rE '_MAINNET_CHAIN_ID\b|\bxChainId\b' --include='*.tsx' --include='*.ts' src/               # SDK leakage
   ```

2. **Read [`checklist.md`](checklist.md)** — top-down cross-cutting checklist. Walk it before touching code.
3. **Fix imports + provider-stack first** ([`breaking-changes/hook-signatures.md`](breaking-changes/hook-signatures.md) § Provider stack). The rest of the codebase won't typecheck without these.
4. **Mechanical sweeps next** — easier wins:
   - `*_MAINNET_CHAIN_ID` → `ChainKeys.X_MAINNET` (one codemod)
   - `useSpokeProvider` deletions
   - `xChainId` → `chainKey` on `XToken` (with care — read shape kept the field)
5. **Per-call-site rewrites:** mutation hook calls (move `params` + `walletProvider` from hook init to `mutate(vars)`), approve-hook returns (`{ approve, isLoading }` → `mutateAsync` + `isPending`), result handling (`data.ok` branching → `mutateAsyncSafe` or `try/catch`).
6. **Delete v1-managed invalidations** (`invalidateMmQueries`-style utilities). Hook-owned now.
7. **Verify with `pnpm tsc --noEmit`** until clean. Then run app smoke tests.

## DO

- **DO** mechanical sweeps before per-call-site rewrites. Type renames and constant renames are codemod-friendly; result handling needs case-by-case attention.
- **DO** prefer `mutateAsyncSafe` for sequenced flows. The user-reject case is modal, not exceptional.
- **DO** `try/catch` `mutateAsync` calls if you keep that call shape. v2's `mutateAsync` rejects on SDK `!ok`.
- **DO** delete consumer-side `invalidate*Queries` utility files. Hook-owned invalidations make them obsolete.
- **DO** swap `BSC_MAINNET_CHAIN_ID` (and the other 14 v1 constants) for `ChainKeys.BSC_MAINNET` (or whichever chain). Codemod-friendly.
- **DO** consult [`../integration/architecture.md`](../integration/architecture.md) when "what does v2 expect instead?" comes up.
- **DO** consult [`../../sdk/migration/`](../../sdk/migration/) for any SDK-leakage migrations (chain-key terminology, `Result<T>` propagation, ConfigService).

## DO NOT

- **DO NOT** convert `data.ok` branching mechanically. v1's `data` was `Result<T>`; v2's `data` is the unwrapped success value. The branching has to move from `onSuccess` to either `mutateAsyncSafe` (preferred) or `try/catch` on `mutateAsync`.
- **DO NOT** keep the legacy `useFooApprove(spokeProvider)` call shape. v2's approve hooks return `SafeUseMutationResult` — call as `useFooApprove()` (no args), then `mutateAsync({ params, walletProvider })`.
- **DO NOT** preserve `useSpokeProvider` "for compat." It's deleted; there's no shim. Pass `walletProvider` from `useWalletProvider({ xChainId: chainKey })` directly into `mutate(vars)`.
- **DO NOT** blanket-replace `srcChain` → `srcChainKey`. The `Intent` *read shape* keeps `srcChain` / `dstChain` (those are `IntentRelayChainId`s). Only the *request-side* params (e.g. `MoneyMarketSupplyParams`) renamed to `srcChainKey` / `dstChainKey`.
- **DO NOT** treat the v1 `useMigrate(spokeProvider)` API as still working. v2 split it into 6 per-action hooks (`useMigrateIcxToSoda`, etc.).
- **DO NOT** add `@sodax/types` as an explicit dep during migration. It's transitively re-exported.

## Stop conditions (defer to user)

| Signal | Why stop |
|---|---|
| User wants to keep v1 dapp-kit | Tell them the shapes are not compatible. They either upgrade or stay on v1. |
| User wants to use React Server Components (RSC) | dapp-kit code goes in client components. Server Components can't run hooks. |
| Codebase has consumer wrappers around dapp-kit hooks that look like dapp-kit's own internals | Examine each — they may be reasonable but check that they preserve `mutateAsyncSafe`. v1 wrappers often replaced React Query's `useMutation` directly. |
| User expects approve hooks to look like before | Show them the new return shape. v2 standardized approve to `SafeUseMutationResult`; `{ approve, isLoading }` is gone. |
| You hit an SDK-level migration item | Defer to [`../../sdk/migration/`](../../sdk/migration/). Don't try to re-explain SDK changes inside dapp-kit migration files — link them out. |

## Verification protocol

```bash
# 1. Type-check the consumer (canonical pass).
pnpm tsc --noEmit   # zero errors expected

# 2. Confirm no leftover v1 patterns.
grep -rE '\buseSpokeProvider\b' src/                  # zero hits
grep -rE 'invalidateMmQueries\b' src/                 # zero hits
grep -rE '_MAINNET_CHAIN_ID\b' src/                   # zero hits
grep -rE 'data\?\.ok\b.*onSuccess' src/               # zero hits — v1 success-path branching is gone

# 3. Confirm mutateAsync calls are properly wrapped.
grep -rE 'mutateAsync\(' src/ | grep -v 'try\|catch\|mutateAsyncSafe'  # zero hits or audit each

# 4. Confirm dapp-kit imports come only from the package root.
grep -rE "@sodax/dapp-kit/[a-z]" src/                 # zero hits (no deep imports)
```

## Done criteria

- [ ] Provider stack updated: `<SodaxProvider config={...}>` + `<QueryClientProvider>` (preferably `createSodaxQueryClient()`).
- [ ] Every v1 hook call site rewritten to single-object params + `mutate(vars)` flow for domain inputs.
- [ ] Every approve hook usage rewritten to `mutateAsync` / `mutateAsyncSafe` + `isPending`.
- [ ] Every mutation result handler converted from `data.ok` branching to `mutateAsyncSafe`'s `result.ok` branching, or to `try/catch` on `mutateAsync`.
- [ ] No `useSpokeProvider`, no `invalidateMmQueries`, no `*_MAINNET_CHAIN_ID` constants.
- [ ] `pnpm tsc --noEmit` clean.
- [ ] App smoke-tested: connect wallet, run one mutation per feature you use.
