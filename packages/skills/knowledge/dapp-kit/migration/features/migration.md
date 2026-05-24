# Migration migration — v1 → v2 (dapp-kit)

Pair: [`../../integration/features/migration.md`](../../integration/features/migration.md).

The biggest single API change in dapp-kit v2: v1 had a single `useMigrate(spokeProvider)`-style hook (often commented out by the time consumers needed it); v2 split it into 6 dedicated hooks.

## TL;DR

> Cross-cutting conventions (drop `spokeProvider`, single-object hook init, `mutate(vars)` for domain inputs, `mutateAsyncSafe` ergonomics) — see [`../breaking-changes/hook-signatures.md`](../breaking-changes/hook-signatures.md) and [`../breaking-changes/result-handling.md`](../breaking-changes/result-handling.md). Feature-specific deltas below:

1. **`useMigrate(spokeProvider)` is gone.** Replaced by **six per-action hooks**:
   - `useMigrateIcxToSoda` — wICX (ICON) → SODA (Sonic)
   - `useRevertMigrateSodaToIcx` — SODA → wICX (revert)
   - `useMigratebnUSD` — legacy bnUSD ↔ new bnUSD (bidirectional)
   - `useMigrateBaln` — BALN (ICON) → SODA with optional lock period
   - `useMigrationApprove` — approve before migration (action-discriminated)
   - `useMigrationAllowance` — check approval (action-discriminated)
2. **`useMigratebnUSD` is bidirectional.** v2 detects direction from `(srcbnUSD, dstbnUSD)` token addresses — no separate forward/reverse hook.
3. **All mutations** drop `spokeProvider`; `walletProvider` flows through `mutate(vars)`. SDK-leakage adds `srcChainKey` / `srcAddress` to all action params.
4. **`useMigrationApprove` / `useMigrationAllowance` are action-discriminated.** Same hook handles all migration approvals; pass `action: 'migrate' | 'revert'` to disambiguate.
5. **BALN `lockupPeriod` is a literal union, not arbitrary number.** `0 | 1 | 2 | 3 | 6 | 12 | 18 | 24` (months).

## Per-method delta

### v1 single hook → v2 six hooks

```diff
- // v1 — single hook
- const migrate = useMigrate(spokeProvider);
- await migrate.mutateAsync({ params: { type: 'icxToSoda', amount, /* ... */ } });

+ // v2 — pick the right hook
+ const { mutateAsyncSafe: migrate } = useMigrateIcxToSoda();
+ const result = await migrate({
+   params: {
+     srcChainKey: ChainKeys.ICON_MAINNET,
+     srcAddress: 'hx...',
+     address: 'cx88fd...',                        // wICX token address
+     amount,
+     dstAddress: '0x...',                         // Sonic recipient
+   },
+   walletProvider,
+ });
+ if (!result.ok) return;
+ const { srcChainTxHash, dstChainTxHash } = result.value;
```

### `useMigratebnUSD` — bidirectional via token addresses

```diff
- // v1 might have had separate forward/reverse hooks (or all-in-one)
+ // v2: one hook; direction detected from (srcbnUSD, dstbnUSD)
+ const { mutateAsyncSafe: migratebnUSD } = useMigratebnUSD();
+ const result = await migratebnUSD({
+   params: {
+     srcChainKey: ChainKeys.BASE_MAINNET,
+     srcAddress: '0x...',
+     srcbnUSD: '0x... (legacy or new)',
+     dstChainKey: ChainKeys.ARBITRUM_MAINNET,
+     dstbnUSD: '0x... (the other one)',
+     amount,
+     dstAddress: '0x...',
+   },
+   walletProvider,
+ });
+ if (!result.ok) {
+   const direction = result.error.context?.direction;   // 'forward' | 'reverse'
+   /* ... */
+ }
```

### `useMigrateBaln` — lock period

```diff
+ const { mutateAsyncSafe: migrateBaln } = useMigrateBaln();
+ await migrateBaln({
+   params: {
+     srcChainKey: ChainKeys.ICON_MAINNET,
+     srcAddress: 'hx...',
+     amount,
+     lockupPeriod: 12,                            // 0 | 1 | 2 | 3 | 6 | 12 | 18 | 24
+     dstAddress: '0x...',
+   },
+   walletProvider,
+ });
```

### `useMigrationApprove` / `useMigrationAllowance` — action-discriminated

```diff
- const { approve } = useMigrationApprove(spokeProvider);
- await approve(params);
+ const { data: isApproved } = useMigrationAllowance({
+   params: { params: revertParams, action: 'revert' },
+ });
+ const { mutateAsync: approve } = useMigrationApprove();
+ await approve({ params: revertParams, walletProvider, action: 'revert' });
```

## Approval requirements

| Migration | Approval needed? |
|---|---|
| ICX/wICX (ICON) → SODA | No (ICON has no ERC-20 allowance) |
| SODA → wICX (revert) | Yes |
| Legacy bnUSD ↔ new bnUSD (EVM/Stellar source) | Yes |
| BALN (ICON) → SODA | No |

## Pitfalls

1. **The single `useMigrate` is gone.** Pick the per-action hook that matches your migration. The v1 one-size-fits-all approach doesn't have a v2 shim.
2. **`useMigratebnUSD` direction detection.** v2 detects from token addresses. If both `srcbnUSD` and `dstbnUSD` are on the same side (both legacy or both new), the SDK rejects with `VALIDATION_FAILED`. Use `error.context?.direction` to disambiguate in error messaging.
3. **`lockupPeriod` is a literal union.** TypeScript rejects `lockupPeriod: 7`. Allowed: `0 | 1 | 2 | 3 | 6 | 12 | 18 | 24`. Reward multiplier ranges 0.5x (0 months) → 1.5x (24 months).
4. **ICON-side migrations don't need approval** — ICON has no ERC-20 allowance mechanism. Don't render an approve step for `useMigrateIcxToSoda` or `useMigrateBaln`.

## Cross-references

- [`../../integration/features/migration.md`](../../integration/features/migration.md) — v2 reference.
- [`../../integration/recipes/migration.md`](../../integration/recipes/migration.md) — full v2 worked examples (ICX, BALN, bnUSD, revert).
- [`@sodax/sdk`: `migration/features/icx-bnusd-baln.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/knowledge/sdk/migration/features/icx-bnusd-baln.md) — underlying SDK migration migration.
