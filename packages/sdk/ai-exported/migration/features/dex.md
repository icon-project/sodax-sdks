# DEX migration — v1 → v2

Pure-SDK migration playbook for `DexService` (`AssetService` + `ClService`).

Pair: [`../../integration/features/dex.md`](../../integration/features/dex.md).

## TL;DR

1. **Drop `spokeProvider`. Pass `walletProvider` directly.** Same as every other feature.
2. **Add `srcChainKey` + `srcAddress` to every action params.** All 6 DEX param types (`CreateAssetDepositParams`, `CreateAssetWithdrawParams`, `ClSupplyParams`, `ClIncreaseLiquidityParams`, `ClDecreaseLiquidityParams`, `ClClaimRewardsParams`) gained both fields and a `<K extends SpokeChainKey>` generic.
3. **`getPools()` is synchronous in v2.** Was `Promise<PoolKey[]>`; now plain `PoolKey[]`. `.then(...)` is a runtime error.
4. **`getAssetsForPool` is chain-key-first.** Was `getAssetsForPool(spokeProvider, poolKey)`; now `getAssetsForPool(srcChainKey, poolKey)`.
5. **`getDeposit` is `Result`-wrapped.** Was `(token, spokeProvider) => Promise<bigint>`; now `(poolToken, walletAddress, chainKey) => Promise<Result<bigint>>`.
6. **`useDexAllowance` and equivalent passes `raw: true`.** Read-only; no walletProvider needed.
7. **`getPoolData` and `getPositionInfo` use the hub publicClient.** Consumers can pass `sodax.hubProvider.publicClient` when needed.
8. **Errors → `SodaxError` + `Result<T>`.** v1's `ConcentratedLiquidityError`, `AssetServiceError` and their type guards are gone.

## Type / symbol cheat sheet

### Field-level renames

| Type | v1 shape | v2 shape | Notes |
|---|---|---|---|
| `CreateAssetDepositParams` | `{ asset, amount, poolToken, dst? }` | `{ srcChainKey, srcAddress, asset, amount, poolToken, dst? }` | Now generic `<K>`. |
| `CreateAssetWithdrawParams` | same | same with `srcChainKey, srcAddress` | |
| `ClSupplyParams` | `{ poolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, sqrtPriceX96 }` | + `srcChainKey, srcAddress` | |
| `ClIncreaseLiquidityParams` | `+ tokenId` | + `srcChainKey, srcAddress` | |
| `ClDecreaseLiquidityParams` | `{ poolKey, tokenId, liquidity, amount0Min, amount1Min }` | + `srcChainKey, srcAddress` | |
| `ClClaimRewardsParams` | `{ poolKey, tokenId, tickLower, tickUpper }` | + `srcChainKey, srcAddress` | |
| `getAssetsForPool` | `(spokeProvider, poolKey)` | `(srcChainKey, poolKey)` | Chain-key-first. Sync. |
| `getPools` | `Promise<PoolKey[]>` | `PoolKey[]` | Sync now. |
| `getDeposit` | `(token, spokeProvider) => Promise<bigint>` | `(poolToken, walletAddress, chainKey) => Promise<Result<bigint>>` | Result-wrapped. |

### Deleted symbols

- `useSpokeProvider` (React) — gone.
- `ConcentratedLiquidityError<ConcentratedLiquidityErrorCode>` and `AssetServiceError<AssetServiceErrorCode>` plus their type guards — replaced by `SodaxError<C>` + `feature: 'dex'`.
- v1 `getDeposit(token, spokeProvider)` overload — replaced by the chain-key-first signature.

### v1 → v2 error code crosswalk (DEX-specific)

| v1 code | v2 code + context |
|---|---|
| `DEPOSIT_FAILED` | `EXECUTION_FAILED` (`action: 'deposit'`) |
| `WITHDRAW_FAILED` | `EXECUTION_FAILED` (`action: 'withdraw'`) |
| `SUPPLY_LIQUIDITY_FAILED` | `EXECUTION_FAILED` (`action: 'supplyLiquidity'`) |
| `INCREASE_LIQUIDITY_FAILED` | `EXECUTION_FAILED` (`action: 'increaseLiquidity'`) |
| `DECREASE_LIQUIDITY_FAILED` | `EXECUTION_FAILED` (`action: 'decreaseLiquidity'`) |
| `CLAIM_REWARDS_FAILED` | `EXECUTION_FAILED` (`action: 'claimRewards'`) |
| `GET_POOL_DATA_FAILED` | `LOOKUP_FAILED` (`method: 'getPoolData'`) |
| `GET_POSITION_INFO_FAILED` | `LOOKUP_FAILED` (`method: 'getPositionInfo'`) |

## Per-method delta

### `deposit` / `withdraw`

```diff
- await sodax.dex.assetService.deposit({ params, spokeProvider });
+ const result = await sodax.dex.assetService.deposit({
+   params: { srcChainKey, srcAddress, asset, amount, poolToken },
+   raw: false,
+   walletProvider,
+ });
+ if (!result.ok) return;
+ const [spokeHash, hubHash] = result.value;
```

### `supplyLiquidity` (mint new) and `increaseLiquidity` (existing)

The pure-helper `createSupplyLiquidityParamsProps` returns the helper-relevant subset (no `srcChainKey`/`srcAddress`). Spread it at the call site:

```diff
- const params = createSupplyLiquidityParamsProps({ /* … */ });
- await supplyMutation.mutateAsync({ params, spokeProvider });
+ const helperOutput = createSupplyLiquidityParamsProps({ /* … */ });
+ const params = { ...helperOutput, srcChainKey, srcAddress: xAccount.address as `0x${string}` };
+ const result = await sodax.dex.clService.supplyLiquidity({ params, raw: false, walletProvider });
+ if (!result.ok) return;
+ const [, hubHash] = result.value;
```

### `getAssetsForPool`

```diff
- const { token0, token1 } = sodax.dex.clService.getAssetsForPool(spokeProvider, poolKey);
+ const { token0, token1 } = sodax.dex.clService.getAssetsForPool(srcChainKey, poolKey);
```

### `getPools`

```diff
- const pools = await sodax.dex.clService.getPools();
+ const pools = sodax.dex.clService.getPools();   // sync
```

The `await` form still compiles (TS allows `await` on non-promises) but `.then(...)` is a runtime error.

### `getDeposit`

```diff
- const balance: bigint = await sodax.dex.assetService.getDeposit(poolToken, spokeProvider);
+ const result = await sodax.dex.assetService.getDeposit(poolToken, walletAddress, chainKey);
+ if (!result.ok) return 0n;
+ const balance = result.value;
```

### Allowance (read-only `raw: true`)

```diff
- const allowed = await sodax.dex.assetService.isAllowanceValid({ params, spokeProvider });
+ const result = await sodax.dex.assetService.isAllowanceValid({ params, raw: true });
+ if (!result.ok) return false;
+ const allowed = result.value;
```

## Pitfalls

1. **Forgetting `raw: true` on `isAllowanceValid`.** TypeScript error: `Property 'walletProvider' is missing`.
2. **Passing `spokeProvider` to `getAssetsForPool`.** Type error — pass `srcChainKey` instead.
3. **`getPools().then(...)` runtime error** — sync now.
4. **Reading `spokeProvider.chainConfig.chain.name` for display.** Gone. Use `baseChainInfo[chainKey]?.name` from `@sodax/sdk`.
5. **Reading `spokeProvider.walletProvider.getWalletAddress()`.** Gone. The wallet provider you passed is the same one you read from — call its `.getWalletAddress()` directly.
6. **`xAccount.address` is typed `string`, not `Address`.** SDK params want `GetAddressType<K>` which for EVM resolves to `` `0x${string}` ``. Cast at the boundary: `xAccount.address as \`0x${string}\``.
7. **`useSupplyLiquidity` mint vs increase routing.** If `params.tokenId && params.isValidPosition` are both truthy, it routes to `increaseLiquidity`; else mints a new position via `supplyLiquidity`. Don't accidentally drop these fields when migrating — they'll silently route to the wrong path.
8. **`assetService.deposit` and `withdraw` always relay to hub.** If you need spoke-only execution (custom orchestration), use `assetService.executeDeposit` directly — but it's not surfaced through the higher-level wrappers.

## Verification

```bash
pnpm -C <your-app-dir> checkTs

# Targeted scans:
grep -rE "spokeProvider:\s*\w+|getAssetsForPool\([^,]*Provider" src/
grep -rE "isConcentratedLiquidityError\b|ConcentratedLiquidityError\b|AssetServiceError\b" src/
grep -rE "getPools\(\)\.then\b" src/
```

## Cross-references

- v2 DEX usage: [`../../integration/features/dex.md`](../../integration/features/dex.md).
- Cross-cutting prerequisites listed in [`../README.md`](../README.md).
