# DEX migration — v1 → v2 (dapp-kit)

Pair: [`../../integration/features/dex.md`](../../integration/features/dex.md).

## TL;DR

> Cross-cutting conventions (drop `spokeProvider`, single-object hook init, `mutate(vars)` for domain inputs, `mutateAsyncSafe` ergonomics) — see [`../breaking-changes/hook-signatures.md`](../breaking-changes/hook-signatures.md) and [`../breaking-changes/result-handling.md`](../breaking-changes/result-handling.md). Feature-specific deltas below:

1. **All mutations** (`useDexDeposit`, `useDexWithdraw`, `useSupplyLiquidity`, `useDecreaseLiquidity`, `useClaimRewards`, `useDexApprove`) — single-object hook init + `mutate({ params, walletProvider })`. SDK-leakage adds required `srcChainKey` + `srcAddress` to all action params.
2. **`useSupplyLiquidity` handles both mint-new and increase-existing** — pass `tokenId` in params for increase, omit for mint. Use `useCreateSupplyLiquidityParams` to handle the routing.
3. **`usePools` returns synchronously** in the SDK. The hook still returns `UseQueryResult` but the underlying call is config-derived (no RPC) — `staleTime: Infinity`, no auto-refresh.
4. **Param builders take a FLAT props object** — `useCreateDepositParams`, `useCreateWithdrawParams`, `useCreateSupplyLiquidityParams`, `useCreateDecreaseLiquidityParams` — NOT `{ params: { ... } }`-wrapped. Their inputs use `srcChainKey` (not `srcChainId`); the result is spread into the mutation's `params` field at the call site.

## Per-method delta

### `useDexDeposit` / `useDexWithdraw`

```diff
- const deposit = useDexDeposit(spokeProvider);
- await deposit.mutateAsync({ params: { asset, amount, poolToken } });
+ const walletProvider = useWalletProvider({ xChainId: ChainKeys.BASE_MAINNET });
+ const { mutateAsyncSafe: deposit } = useDexDeposit();
+ const result = await deposit({
+   params: {
+     srcChainKey: ChainKeys.BASE_MAINNET,
+     srcAddress,                          // NEW
+     asset,
+     amount,
+     poolToken,
+   },
+   walletProvider,
+ });
+ if (!result.ok) return;
+ const { srcChainTxHash, dstChainTxHash } = result.value;
```

### `useSupplyLiquidity` — mint vs increase routing

```diff
- // v1: separate hooks for mint and increase
- const mint = useMintLiquidity(spokeProvider);
- const increase = useIncreaseLiquidity(spokeProvider);
- if (existingTokenId) {
-   await increase.mutateAsync({ params: { tokenId, poolKey, ... } });
- } else {
-   await mint.mutateAsync({ params: { poolKey, ... } });
- }

+ // v2: single hook handles both via tokenId presence
+ const { mutateAsyncSafe: supply } = useSupplyLiquidity();
+ const supplyParams = useCreateSupplyLiquidityParams({
+   params: { poolKey, tickLower, tickUpper, amount0, amount1, tokenId: existingTokenId },
+ });
+ if (supplyParams && walletProvider) {
+   const result = await supply({ params: supplyParams, walletProvider });
+ }
```

### `useDecreaseLiquidity` / `useClaimRewards`

Standard pattern — drop `spokeProvider` from hook init, add `srcChainKey` / `srcAddress` to params, pass `walletProvider` via `mutate(vars)`.

### `useDexAllowance` / `useDexApprove`

`useDexAllowance` wraps the deposit params under `params.payload`. Read-only — no `walletProvider`:

```diff
- const { data: allowance } = useDexAllowance({ params: depositParams, walletProvider });
+ const { data: isApproved } = useDexAllowance({ params: { payload: depositParams } });
+ // `data` is `boolean | undefined`; the hook calls `isAllowanceValid` with `raw: true`.
```

`useDexApprove` mutation drops `spokeProvider` from hook init; `mutate(vars)` takes `{ params, walletProvider }`.

### `usePoolData` / `usePositionInfo` / `usePools`

Convert to single-object query shape:

```diff
- const { data } = usePoolData(poolKey);
+ const { data } = usePoolData({ params: { poolKey } });

- const { data } = usePositionInfo(tokenId, poolKey);
+ const { data } = usePositionInfo({ params: { tokenId, poolKey } });

- const { data: pools } = usePools();
+ const { data: pools } = usePools({});   // single-object shape, even with no params
```

## Pitfalls

1. **`useSupplyLiquidity` is now ONE hook for both mint and increase.** v1 may have had two separate hooks. Use `tokenId` presence in `params` to drive the routing — `useCreateSupplyLiquidityParams` handles this for you.
2. **Two-step flow stays the same.** First `useDexDeposit` brings the spoke asset to the hub as pool-token shares. Then `useSupplyLiquidity` uses those shares to mint/grow a position. UI sequencing unchanged.
3. **Ticks are logarithmic.** Calculation libraries unchanged; just be aware that `tickLower` / `tickUpper` are tick indices, not prices.
4. **`usePools` never auto-refreshes** — pools are static config. Override `queryOptions.refetchInterval` only if you really know your config changed.

## Cross-references

- [`../../integration/features/dex.md`](../../integration/features/dex.md) — v2 reference.
- [`../../integration/recipes/dex.md`](../../integration/recipes/dex.md) — full v2 worked example.
- [`../../../../sdk/ai-exported/migration/features/dex.md`](../../../../sdk/ai-exported/migration/features/dex.md) — underlying SDK DEX migration.
