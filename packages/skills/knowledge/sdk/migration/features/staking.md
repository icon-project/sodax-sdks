# Staking migration — v1 → v2

Pure-SDK migration playbook for `StakingService`.

Pair: [`../../integration/features/staking.md`](../../integration/features/staking.md).

## TL;DR

1. **Drop `spokeProvider` from every params object.** Pass `walletProvider` directly into the SDK call.
2. **Add `srcChainKey` + `srcAddress` to every `*Params<K>`.** `account` field is renamed to `srcAddress`.
3. **All 5 staking actions are cross-chain.** Even though staking writes happen on the hub, every SDK method (`stake`, `unstake`, `instantUnstake`, `claim`, `cancelUnstake`) accepts `srcChainKey: K extends SpokeChainKey` and relays spoke→hub via `relayTxAndWaitPacket`. **Return shape is always `Result<TxHashPair>`.**
4. **`approve` is an exception — it returns `Result<TxReturnType<K, false>>` (single hash).** Approve is spoke-only (no relay) — it just spends ERC20 allowance on the source chain.
5. **Approve and allowance are action-discriminated.** `staking.approve` and `staking.isAllowanceValid` take a `StakingParamsUnion` discriminated by `params.action`. `'stake'` approves SODA; `'unstake'` and `'instantUnstake'` approve xSoda.
6. **Info getter signatures changed.** v1 took `spokeProvider`; v2 takes `(srcAddress, srcChainKey)`. The SDK derives the hub wallet internally.
7. **Hub-only / amount-only reads have no chain context.** `getStakingConfig()`, `getStakeRatio(amount)`, `getInstantUnstakeRatio(amount)`, `getConvertedAssets(amount)` — none accept `srcChainKey`. (Take `bigint` amount directly, not an object.) `getStakeRatio` returns `Result<[xSodaAmount, previewDepositAmount]>` (a tuple — both are bigints).
8. **Errors → `SodaxError` + `Result<T>`.** v1's `StakingError<StakingErrorCode>` is gone.

## Type / symbol cheat sheet

### Field-level renames

| Type | v1 shape | v2 shape | Notes |
|---|---|---|---|
| `StakeParams` | `{ amount, account, minReceive, action: 'stake' }` | `{ srcChainKey, srcAddress, amount, minReceive, action: 'stake' }` | Now generic `<K>`. `account` → `srcAddress`. |
| `UnstakeParams` | `{ amount, account, action: 'unstake' }` | `{ srcChainKey, srcAddress, amount, action: 'unstake' }` | |
| `InstantUnstakeParams` | `{ amount, minAmount, account, action: 'instantUnstake' }` | `{ srcChainKey, srcAddress, amount, minAmount, action: 'instantUnstake' }` | |
| `ClaimParams` | `{ requestId, amount, action: 'claim' }` | `{ srcChainKey, srcAddress, requestId, amount, action: 'claim' }` | Adds chain context. |
| `CancelUnstakeParams` | `{ requestId, action: 'cancelUnstake' }` | `{ srcChainKey, srcAddress, requestId, action: 'cancelUnstake' }` | Adds chain context. |
| `getStakingInfo` (read) | `(spokeProvider) => Promise<StakingInfo>` | `(srcAddress, srcChainKey) => Promise<Result<StakingInfo>>` | Renamed to `getStakingInfoFromSpoke` (the v1 `getStakingInfo` was hub-only and is not surfaced now). |
| `getUnstakingInfo` (read) | `(userAddress, spokeProvider)` | `(srcAddress, srcChainKey)` | v1 ignored `userAddress`; v2 reads it for real. |
| `getUnstakingInfoWithPenalty` (read) | new (v2) | `(srcAddress, srcChainKey) => Promise<Result<UnstakingInfo & { requestsWithPenalty: UnstakeRequestWithPenalty[] }>>` | Wraps `getUnstakingInfo`'s base shape with a penalty-augmented request list. |

### Deleted symbols

- `StakingError<StakingErrorCode>` and `isStakingError` — replaced by `SodaxError<C>` + `feature: 'staking'`.
- v1 `getStakingInfo(hubAddress, …)` — not exposed as a public method in v2. Use `getStakingInfoFromSpoke(srcAddress, srcChainKey)`; the SDK derives the hub wallet via `HubService.getUserHubWalletAddress` internally.
- `spokeProvider instanceof SonicSpokeProvider` runtime checks — replace with `isHubChainKeyType(chainKey)` from `@sodax/sdk`.

### v1 → v2 error code crosswalk (staking-specific)

| v1 `StakingErrorCode` | v2 code + context |
|---|---|
| `STAKE_FAILED` | `EXECUTION_FAILED` (`action: 'stake'`) |
| `UNSTAKE_FAILED` | `EXECUTION_FAILED` (`action: 'unstake'`) |
| `INSTANT_UNSTAKE_FAILED` | `EXECUTION_FAILED` (`action: 'instantUnstake'`) |
| `CLAIM_FAILED` | `EXECUTION_FAILED` (`action: 'claim'`) |
| `CANCEL_UNSTAKE_FAILED` | `EXECUTION_FAILED` (`action: 'cancelUnstake'`) |
| `GET_STAKING_INFO_FAILED` | `LOOKUP_FAILED` (`method: 'getStakingInfo'` or `'getStakingInfoFromSpoke'`) |
| `GET_UNSTAKING_INFO_FAILED` | `LOOKUP_FAILED` (`method: 'getUnstakingInfo'`) |
| `GET_STAKING_CONFIG_FAILED` | `LOOKUP_FAILED` (`method: 'getStakingConfig'`) |
| `GET_STAKE_RATIO_FAILED` | `LOOKUP_FAILED` (`method: 'getStakeRatio'`) |

## Per-method delta

### `stake`

```diff
- await sodax.staking.stake({ amount, account, minReceive, action: 'stake' }, spokeProvider);
+ const result = await sodax.staking.stake({
+   params: {
+     srcChainKey: ChainKeys.ARBITRUM_MAINNET,
+     srcAddress: '0x…',
+     amount, minReceive,
+     action: 'stake',
+   },
+   raw: false,
+   walletProvider,
+ });
+ if (!result.ok) return;
+ const { srcChainTxHash, dstChainTxHash } = result.value;
```

### `unstake` / `instantUnstake` / `claim` / `cancelUnstake`

Same shape as stake. `account` → `srcAddress`. `requestId` (claim, cancelUnstake) is unchanged.

### `approve` / `isAllowanceValid` — action-discriminated

```diff
- await sodax.staking.approveStake({ amount, account, ... }, spokeProvider);
+ await sodax.staking.approve({
+   params: { srcChainKey, srcAddress, amount, action: 'stake' },
+   raw: false,
+   walletProvider,
+ });
```

For `isAllowanceValid`:

```ts
const result = await sodax.staking.isAllowanceValid({
  params: { srcChainKey, srcAddress, amount, action: 'stake' },
  raw: true,    // read-only
});
```

### Info reads

```diff
- const info = await sodax.staking.getStakingInfo(spokeProvider);
+ const result = await sodax.staking.getStakingInfoFromSpoke(srcAddress, srcChainKey);
+ if (!result.ok) return;
+ const info = result.value;
```

For amount-only reads (no chain context):

```ts
const result = await sodax.staking.getStakeRatio(parseUnits('100', 18));
if (result.ok) {
  const [xSodaAmount, previewDepositAmount] = result.value;
}
```

## Pitfalls

Cross-cutting traps (Result destructuring, error-model migration, srcChain/dstChain renames, etc.) live in [`../ai-rules.md`](../ai-rules.md). The list below is feature-specific — typecheck fingerprints, return-shape diffs, and gotchas unique to this feature.

1. **Wrong return shape for actions.** Treating `stake/unstake/etc.` as returning `Result<TxReturnType<K, false>>` (single hash) is **wrong** — they return `Result<TxHashPair>` because they always relay spoke→hub. Only `approve` returns a single hash.
2. **Forgetting `raw: true` on the allowance query.** TypeScript error: `Property 'walletProvider' is missing`. `isAllowanceValid` requires `WalletProviderSlot<K, Raw>`; `raw: false` would force a wallet provider. Use `raw: true` for read-only.
3. **Forgetting to remove the v1 `account` field from params.** v2 uses `srcAddress`. If both are set, TypeScript rejects the literal.
4. **`getStakingInfo(hubAddress)` is not a public method in v2.** v1 had it for direct hub queries. v2 has `getStakingInfoFromSpoke(srcAddress, srcChainKey)` which derives the hub wallet internally. Use the spoke variant.
5. **`UnstakingInfo` no longer accepts `userAddress` separately.** v1 took both `spokeProvider` and `userAddress` props but ignored `userAddress` inside. v2 takes `srcAddress` and uses it.

## Verification

```bash
pnpm -C <your-app-dir> checkTs

# Targeted scans:
grep -rE "spokeProvider:\s*\w+|account:\s*[`'][^`']+['\"`]" src/    # leftover v1 patterns
grep -rE "isStakingError\b|StakingError\b" src/
```

## Cross-references

- v2 staking usage: [`../../integration/features/staking.md`](../../integration/features/staking.md).
- Cross-cutting prerequisites listed in [`../README.md`](../README.md).
