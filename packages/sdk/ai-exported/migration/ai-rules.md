# AI rules — `@sodax/sdk` v1 → v2 migration

DO / DO NOT / workflow / stop conditions for AI agents porting v1 `@sodax/sdk` consumer code to v2. Read this **before** the per-feature migration files — these rules prevent the most common porting mistakes.

## Workflow (do these in order)

1. **Survey the consumer.** Grep for v1 fingerprints to scope the migration:

   ```bash
   pnpm tsc --noEmit > /tmp/v1-errors.log 2>&1   # baseline error population
   grep -rE '_MAINNET_CHAIN_ID\b|\bSpokeProvider\b|\bxChainId\b|\bSpokeChainId\b|hubAssets|moneyMarketSupportedTokens' src/
   grep -rE 'instanceof (MoneyMarketError|IntentError|StakingError|BridgeError|MigrationError|AssetServiceError|ConcentratedLiquidityError|RelayError)' src/
   ```

2. **Read the cross-cutting docs first.** [`README.md`](README.md) → [`breaking-changes/type-system.md`](breaking-changes/type-system.md) → [`breaking-changes/architecture.md`](breaking-changes/architecture.md) → [`breaking-changes/result-and-errors.md`](breaking-changes/result-and-errors.md). Then [`features/<x>.md`](features/) for each feature you use.
3. **Apply changes in order: type-level first, runtime second.** Type-level renames don't affect behavior; runtime patterns (Result branching, error model) require thinking. Doing them in the wrong order means the typecheck stays noisy and you can't see the real problems.
4. **Re-run `pnpm tsc --noEmit` after every step.** Each step should reduce the error count. If errors grow, you've introduced something — back out and try again.

## DO

- **DO** start with mechanical type renames:
  - `*_MAINNET_CHAIN_ID` → `ChainKeys.*` (regex: `(\w+)_MAINNET_CHAIN_ID` → `ChainKeys.$1_MAINNET`).
  - `xChainId` → `chainKey` (on `XToken` and tokens-likes).
  - `SpokeChainId` / `ChainId` → `SpokeChainKey`.
  - `Token` → `XToken`.
  - `AddressType` → `BtcAddressType` (only at `@sodax/types` import sites).
- **DO** add `srcChainKey` + `srcAddress` to every action params object (every `MoneyMarketSupplyParams`, `StakeParams`, `CreateAssetDepositParams`, etc. now requires both).
- **DO** add the `raw: false` (or `raw: true`) discriminator to every signed call shape that previously took `{ intentParams, spokeProvider }`. Also rename `intentParams` → `params` and drop `spokeProvider` in favor of `walletProvider`.
- **DO** convert v1 `try/catch` to `result.ok` branching last — touching every call site is the biggest commit, easiest to do once the type-level changes settled.
- **DO** treat the `Result<T>` ↔ `try/catch` migration as the *highest-leverage* change. If you stop early, ensure result branching is at least in place even if the surrounding error UX is rough.
- **DO** use `isSodaxError(e)` over bare `instanceof SodaxError` in the new error-handling branches. `instanceof` is fragile across bundle copies.
- **DO** branch on `(error.feature, error.code)` for fine-grained UX. The narrow per-method code unions enable exhaustive `switch`.

## DO NOT

- **DO NOT** grep-replace `srcChain` → `srcChainKey` blindly. The `Intent` *read* shape (returned from `createIntent` / `getIntentByHash` / etc.) keeps `srcChain` and `dstChain` as `IntentRelayChainId` (bigint) — those did **not** rename. Only **request** types changed (`CreateIntentParams`, `CreateLimitOrderParams`, `SubmitSwapTxRequest`).
- **DO NOT** treat `instanceof MoneyMarketError` (or any other module-error class) as still working. Those classes are deleted. Replace with `isSodaxError(e) && e.feature === 'moneyMarket'`.
- **DO NOT** destructure cross-chain mutation results as arrays. v1 had `bridge()` returning a string and others returning tuples; v2 returns `TxHashPair = { srcChainTxHash, dstChainTxHash }` for **every** cross-chain mutation (bridge, staking, dex, MM, migration). Destructure as `{ srcChainTxHash, dstChainTxHash } = result.value`.
- **DO NOT** assume `BalnSwapService` lock-management methods (`stake`, `unstake`, `claim`, `claimUnstaked`, `cancelUnstake`, `getDetailedUserLocks`) return `Result<T>`. They still throw — known carve-out. Keep `try/catch` for those specific calls.
- **DO NOT** keep `try/catch` blocks expecting them to catch SDK-level failures from non-Baln methods. v2 mutation methods resolve `{ ok: false, error }` rather than throwing — `catch` only fires for synchronous wrapper exceptions (e.g. missing `walletProvider`).
- **DO NOT** call `getStakingInfo(hubAddress)` in v2. It's `getStakingInfoFromSpoke(srcAddress, srcChainKey)` now. `getStakingInfo` is not a public method.
- **DO NOT** import `@sodax/types` as a peer dependency. It's bundled into `@sodax/sdk`'s public surface; declaring it separately invites version skew.
- **DO NOT** keep `try { await sodax.swaps.createIntent(...) } catch` and expect to inspect `e.code === 'CREATE_INTENT_FAILED'`. The v2 code is `INTENT_CREATION_FAILED` and lives on `result.error.code` (Result branch), not on a thrown error. See [`reference/error-code-crosswalk.md`](reference/error-code-crosswalk.md) for the full v1 → v2 code crosswalk.

## Stop conditions (defer to user)

| Signal | Why stop |
|---|---|
| v1 code uses framework-layer wrapper hooks (any `use*` identifier that wraps SDK calls rather than calling `@sodax/sdk` directly) | This migration tree covers Core SDK call sites only. Framework-layer migrations belong to separate ai-exported trees in their own packages. Tell the user to consult those. |
| v1 code uses `@sodax/wallet-sdk-core` classes | Those classes still exist in v2 of that separate package. Their constructor shapes may have changed — refer to that package's docs, not this tree. |
| Consumer wants to skip the `Result<T>` migration | Explain that v2 SDK calls don't throw for SDK-level failures; without `result.ok` branching the consumer silently swallows errors. Don't silently skip. |
| Consumer maintains a `*SpokeProvider` wrapper / shim | Don't try to recreate a v1-shaped wrapper in v2 — pass `walletProvider` directly into call payloads. The wrapper isn't doing useful work in v2's design. |

## Verification protocol

```bash
# 1. Typecheck must reach zero errors.
pnpm tsc --noEmit

# 2. No leftover v1 fingerprints.
grep -rE '_MAINNET_CHAIN_ID\b|\bxChainId\b|\bSpokeChainId\b|\bSpokeProvider\b|hubAssets|moneyMarketSupportedTokens' src/   # should be empty

# 3. No leftover v1 error type imports.
grep -rE 'MoneyMarketError|IntentError|StakingError|BridgeError|MigrationError|AssetServiceError|ConcentratedLiquidityError|RelayError' src/   # should be empty

# 4. No leftover try/catch around SDK calls expecting to catch SDK-level failures.
#    (Manual review — heuristic, not mechanical.)
grep -rB1 -A3 'try {' src/ | grep -A2 'await sodax\.'   # eyeball each match
```

## Done criteria

- [ ] `pnpm tsc --noEmit` returns 0 errors.
- [ ] No `*_MAINNET_CHAIN_ID` references remain.
- [ ] No `xChainId` field accesses remain.
- [ ] No `SpokeProvider` / `*SpokeProvider` references remain.
- [ ] No imports of `MoneyMarketError`, `IntentError`, `StakingError`, etc.
- [ ] Every `await sodax.<feature>.<method>(...)` call site has `if (!result.ok)` branching.
- [ ] `instanceof SodaxError` is replaced with `isSodaxError(e)` in cross-bundle code.
- [ ] `BalnSwapService` lock methods are wrapped in `try/catch` (still-throws carve-out).
