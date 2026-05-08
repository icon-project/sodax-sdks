# Token migration (ICX/bnUSD/BALN) — v1 → v2

Pure-SDK migration playbook for `MigrationService` (the SDK module — not v1→v2 SDK porting).

Pair: [`../../integration/features/icx-bnusd-baln.md`](../../integration/features/icx-bnusd-baln.md).

## TL;DR

1. **Drop `spokeProvider`. Pass `walletProvider` directly.**
2. **Add `srcChainKey` + `srcAddress` to every action params.** All migration param types (`MigrationParams<K>`, `UnifiedBnUSDMigrateParams<K>`, `IcxToSodaMigrateParams<K>`, `RevertSodaToIcxParams<K>`, `BalnSwapParams<K>`) gained both fields and a `<K>` generic.
3. **All 4 orchestrator methods return `Result<[SpokeTxHash, HubTxHash]>`.** v1 returned a string tx hash and threw on error.
4. **`migratebnUSD` carries `direction` on error context** — `'forward'` (legacy → new) or `'reverse'` (new → legacy). The SDK detects direction from `(srcToken, dstToken)` addresses.
5. **`BalnSwapService` lock-management methods STILL THROW.** `claim`, `claimUnstaked`, `stake`, `unstake`, `cancelUnstake`, `getDetailedUserLocks` — these 6 methods preserve the v1 throw-on-error contract. Wrap in `try/catch` until a future cleanup release converts them to `Result`.
6. **Errors → `SodaxError` + `Result<T>`.** v1's `MigrationError<MigrationErrorCode>` is gone.

## Type / symbol cheat sheet

### Field-level renames

| Type | v1 shape | v2 shape | Notes |
|---|---|---|---|
| `MigrationParams` | non-generic | `MigrationParams<K extends SpokeChainKey>` with `srcChainKey`, `srcAddress`, `amount`, `dstAddress?` | Generic added. |
| `UnifiedBnUSDMigrateParams` | non-generic | `UnifiedBnUSDMigrateParams<K>` extends `MigrationParams<K>` with `srcToken`, `dstToken` | Generic added. |
| `BalnSwapParams` | `{ amount, lockPeriodMonths }` | `MigrationParams<K> & { lockPeriodMonths }` | Adds chain context. |

### Deleted symbols

- `MigrationError<MigrationErrorCode>` and `isMigrationError` — replaced by `SodaxError<C>` + `feature: 'migration'`.
- `useSpokeProvider` (React) — gone.
- The 6 v1 separate-method-per-direction names (`migrateBnUSDForward`, `migrateBnUSDReverse`, …) — collapsed into `migratebnUSD` with auto-direction detection on `error.context.direction`.

### v1 → v2 error code crosswalk

| v1 `MigrationErrorCode` | v2 code + context |
|---|---|
| `MIGRATE_BNUSD_FORWARD_FAILED` | `EXECUTION_FAILED` (`action: 'migratebnUSD'`, `direction: 'forward'`) |
| `MIGRATE_BNUSD_REVERSE_FAILED` | `EXECUTION_FAILED` (`action: 'migratebnUSD'`, `direction: 'reverse'`) |
| `MIGRATE_ICX_TO_SODA_FAILED` | `EXECUTION_FAILED` (`action: 'migrateIcxToSoda'`) |
| `REVERT_MIGRATE_SODA_TO_ICX_FAILED` | `EXECUTION_FAILED` (`action: 'revertMigrateSodaToIcx'`) |
| `MIGRATE_BALN_FAILED` | `EXECUTION_FAILED` (`action: 'migrateBaln'`) |
| `GET_AVAILABLE_AMOUNT_FAILED` | `LOOKUP_FAILED` (`method: 'getAvailableAmount'`) |

`migratebnUSD` additionally has `phase: 'destinationExecution'` on errors from its secondary `waitUntilIntentExecuted` watcher (after the primary relay completes, bnUSD waits for the destination contract to finalize).

## Per-method delta

### `migratebnUSD` (replaces v1 forward + reverse methods)

```diff
- // v1 had two methods:
- await sodax.migration.migrateBnUSDForward({ amount, /* … */ }, spokeProvider);
- await sodax.migration.migrateBnUSDReverse({ amount, /* … */ }, spokeProvider);

+ // v2 has one method; SDK detects direction from (srcToken, dstToken):
+ const result = await sodax.migration.migratebnUSD({
+   params: {
+     srcChainKey, srcAddress,
+     srcToken,    // legacy or new bnUSD
+     dstToken,    // the other one
+     amount,
+     dstAddress,
+   },
+   raw: false,
+   walletProvider,
+ });
+ if (!result.ok) {
+   const dir = result.error.context?.direction;  // 'forward' | 'reverse'
+   /* … */
+ }
```

### `migrateIcxToSoda` / `revertMigrateSodaToIcx` / `migrateBaln`

Standard pattern:

```diff
- await sodax.migration.migrateIcxToSoda({ amount }, spokeProvider);
+ const result = await sodax.migration.migrateIcxToSoda({
+   params: { srcChainKey: ChainKeys.ICON_MAINNET, srcAddress: 'hx…', amount },
+   raw: false,
+   walletProvider: iconWp,
+ });
+ if (!result.ok) return;
+ const [spokeHash, hubHash] = result.value;
```

`migrateBaln` adds `lockPeriodMonths: 0 | 1 | 2 | 3 | 6 | 12 | 18 | 24` to the params. Reward multiplier ranges 0.5x (0 months) – 1.5x (24 months).

### Approve / allowance — action-discriminated

```ts
await sodax.migration.approve({
  params: { srcChainKey, srcAddress, amount, action: 'migrateBaln' /* or migratebnUSD | migrateIcxToSoda | revertMigrateSodaToIcx */ },
  raw: false,
  walletProvider,
});

const allowed = await sodax.migration.isAllowanceValid({
  params: { srcChainKey, srcAddress, amount, action: 'migrateBaln' },
  raw: true,    // read-only
});
```

### `getAvailableAmount` (claimable from partial migration)

```diff
- const amount: bigint = await sodax.migration.icx.getAvailableAmount(spokeProvider);
+ const result = await sodax.migration.icxMigration.getAvailableAmount();   // sub-service renamed; takes no args in v2
+ if (!result.ok) return 0n;
+ const amount = result.value;
```

### BALN lock management — STILL THROWS

```diff
  try {
-   const tx = await sodax.migration.balnSwapService.stake({ amount, lockPeriod }, spokeProvider);
+   const tx = await sodax.migration.balnSwapService.stake({
+     params: { srcChainKey, srcAddress, amount, lockPeriodMonths },
+     raw: false,
+     walletProvider,
+   });
    /* … */
  } catch (e) {
    /* still v1-style: catch the throw */
  }
```

`claim`, `claimUnstaked`, `unstake`, `cancelUnstake`, `getDetailedUserLocks` follow the same pattern. They preserve the throw-on-error contract for now — future cleanup will Result-wrap them.

## Pitfalls

1. **`migratebnUSD` direction detection.** v1 had explicit forward/reverse methods; v2 detects from `(srcToken, dstToken)`. If both are on the same side (both legacy or both new), the SDK rejects with `VALIDATION_FAILED`. Use the `direction` field on `error.context` to disambiguate in error messaging.
2. **BALN lock methods don't return `Result`.** Be careful migrating wrappers — if your wrapper assumes Result-shape, lock methods will produce `undefined.ok` runtime errors. Keep the `try/catch` shape.
3. **`lockPeriodMonths` is a literal union, not arbitrary `number`.** TypeScript rejects `lockPeriodMonths: 7`. Allowed values: `0 | 1 | 2 | 3 | 6 | 12 | 18 | 24`.
4. **`getAvailableAmount` lives on the sub-service `sodax.migration.icxMigration` and takes no arguments.** v1 expected `(spokeProvider)`; v2 reads on-chain SODA liquidity directly from the hub provider, so the method needs no chain context. Sub-service field names: `sodax.migration.icxMigration`, `sodax.migration.bnUSDMigrationService`, `sodax.migration.balnSwapService`.
5. **`destinationExecution` phase on bnUSD errors** — these errors land **after** the relay succeeds. The spoke and hub txs may already exist; the destination-side finalization is what failed. Distinguish from primary relay errors (`phase: 'relay'`) when surfacing UX.

## Verification

```bash
pnpm -C <your-app-dir> checkTs

grep -rE "spokeProvider:\s*\w+|migrateBnUSDForward\b|migrateBnUSDReverse\b|isMigrationError\b|MigrationError\b" src/
```

## Cross-references

- v2 token migration usage: [`../../integration/features/icx-bnusd-baln.md`](../../integration/features/icx-bnusd-baln.md).
- Cross-cutting prerequisites listed in [`../README.md`](../README.md).
