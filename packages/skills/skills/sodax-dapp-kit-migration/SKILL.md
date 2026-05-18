---
name: sodax-dapp-kit-migration
description: Port EXISTING v1 `@sodax/dapp-kit` React hooks to v2 — a deep canonicalization pass: single-object hook params, mandatory `mutateAsyncSafe`, hook-owned invalidations, throw-on-`Result.!ok` inside `mutationFn`, canonical queryKey/mutationKey conventions. Plus the SDK underneath was reshaped (chain-key-driven routing, `Result<T>` everywhere, `WalletProviderSlot<K, Raw>`). v1 dapp-kit code will not compile against v2. Use whenever a React dapp imports v1 hooks (positional args, hook-init `spokeProvider`, `useSpokeProvider`, `invalidateMmQueries`, legacy `useMigrate`, `*_MAINNET_CHAIN_ID`). Triggers on "migrate @sodax/dapp-kit", "useSpokeProvider gone", "dapp-kit v1 → v2", "invalidateMmQueries broken", "dapp-kit hook signatures changed".
---

# When to use this skill

Pick this skill when the consumer has v1 dapp-kit patterns. Grep signals:

```bash
grep -rE 'useSpokeProvider|invalidateMmQueries|useMigrate\b' src/
grep -rE '_MAINNET_CHAIN_ID\b|\bxChainId\b' src/
```

If the project has both v1 patterns AND wants new features: **migration first, then integration**. Stale v1 patterns leak into new code if you skip it.

For new v2 code with no v1 history → use `sodax-dapp-kit-integration` instead.

The SDK underneath also changed — load `sodax-sdk-migration` alongside this one (the migration trees cross-link).

# Workflow

1. Read [`../../knowledge/dapp-kit/migration/ai-rules.md`](../../knowledge/dapp-kit/migration/ai-rules.md) — DO / DO NOT / workflow / stop conditions.
2. Read [`../../knowledge/dapp-kit/migration/README.md`](../../knowledge/dapp-kit/migration/README.md) — overview, reading order, glossary.
3. Walk [`checklist.md`](../../knowledge/dapp-kit/migration/checklist.md) — top-down cross-cutting steps.
4. **Cross-cutting breaking changes** in order:
   - [`breaking-changes/hook-signatures.md`](../../knowledge/dapp-kit/migration/breaking-changes/hook-signatures.md) — single-arg policy + `ReadHookParams` / `MutationHookParams`.
   - [`breaking-changes/result-handling.md`](../../knowledge/dapp-kit/migration/breaking-changes/result-handling.md) — `Result<T>` success-path → throws; `mutateAsyncSafe`.
   - [`breaking-changes/querykey-conventions.md`](../../knowledge/dapp-kit/migration/breaking-changes/querykey-conventions.md) — camelCase + default mutationKey.
   - [`breaking-changes/sdk-leakage.md`](../../knowledge/dapp-kit/migration/breaking-changes/sdk-leakage.md) — cross-links to SDK migration tree.
5. **Per-feature playbooks** under [`features/`](../../knowledge/dapp-kit/migration/features/) — `swap.md`, `money-market.md`, `staking.md`, `bridge.md`, `dex.md`, `migration.md`, `bitcoin.md`, `auxiliary-services.md`.
6. **Codemods + adapters** → [`recipes.md`](../../knowledge/dapp-kit/migration/recipes.md).
7. **Reference** → [`reference/`](../../knowledge/dapp-kit/migration/reference/) — `deleted-hooks.md` (e.g. `useSpokeProvider`, `invalidateMmQueries`, legacy `useMigrate`), `renamed-hooks.md`, `error-shape-crosswalk.md`.

# Top traps to avoid

1. **Reaching for `useSpokeProvider`.** Deleted. Pass `walletProvider` from `useWalletProvider({ xChainId: chainKey })` (`@sodax/wallet-sdk-react`) directly into `mutate(vars)`.
2. **Treating mutation `data` as `Result<T>`.** v2's `mutationFn` unwraps before resolving — `data` is the unwrapped success value.
3. **Forgetting `try/catch` on `mutateAsync`.** v2's `mutateAsync` rejects on SDK `!ok`. Prefer `mutateAsyncSafe` (never rejects).
4. **Hook-level `spokeProvider` / `params`.** v1 hooks took these positionally or at hook-init. v2 hooks take only `{ mutationOptions }` (mutations) or `{ params, queryOptions }` (queries). All domain inputs live in `mutate(vars)` for mutations.
5. **Reading `xToken.xChainId` or hard-coding `*_MAINNET_CHAIN_ID`.** SDK leakage. Renamed: `XToken.chainKey`, `ChainKeys.X_MAINNET`.

# Verification

```bash
pnpm tsc --noEmit   # must exit clean
grep -rE 'useSpokeProvider|invalidateMmQueries\b' src/   # empty
```

Manual:
- Sequenced flows use `mutateAsyncSafe` and branch on `result.ok`.
- React Query devtools show hook-owned invalidations on success (consumer `onSuccess` runs after, doesn't duplicate them).

# Related skills

- `sodax-dapp-kit-integration` — write new v2 code (after migration completes).
- `sodax-sdk-migration` — the SDK-side migration runs in lockstep (chain-key renames, Result, error model).
- `sodax-wallet-sdk-react-migration` — if the wallet layer also has v1 patterns.
