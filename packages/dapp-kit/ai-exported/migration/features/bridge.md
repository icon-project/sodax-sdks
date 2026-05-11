# Bridge migration — v1 → v2 (dapp-kit)

Pair: [`../../integration/features/bridge.md`](../../integration/features/bridge.md).

## TL;DR

> Cross-cutting conventions (drop `spokeProvider`, single-object hook init, `mutate(vars)` for domain inputs, `mutateAsyncSafe` ergonomics) — see [`../breaking-changes/hook-signatures.md`](../breaking-changes/hook-signatures.md) and [`../breaking-changes/result-handling.md`](../breaking-changes/result-handling.md). Feature-specific deltas below:

1. **`CreateBridgeIntentParams` field renames** (SDK-leakage):
   - `srcChainId` → `srcChainKey`
   - `dstChainId` → `dstChainKey`
   - `recipient` → `dstAddress`
   - **NEW required**: `srcAddress`
2. **`useBridge` return is `TxHashPair`, not a tuple.** v1 may have returned `[spokeTxHash, hubTxHash]`; v2 returns `{ srcChainTxHash, dstChainTxHash }`. Don't destructure as array.
3. **`useGetBridgeableAmount` reshape.** v1 took `(srcChainId, srcAsset, dstChainId, dstAsset)`. v2 takes `{ from: XToken, to: XToken }` — each `XToken` carries its own `chainKey`.
4. **`useGetBridgeableAmount` return value is `BridgeLimit`, not bare `bigint`.** Access `.value.amount` and `.value.decimals`.
5. **`useGetBridgeableTokens` is sync now** in the SDK. The hook still returns `UseQueryResult` but the underlying SDK call doesn't fire RPC — it's config-derived.
6. **Allowance/approve** — same shape changes as every other feature.

## Per-method delta

### `useBridge` — params + return

```diff
  function BridgeButton({ srcAddress }) {
-   const bridge = useBridge(spokeProvider);
+   const walletProvider = useWalletProvider({ xChainId: ChainKeys.BASE_MAINNET });
+   const { mutateAsyncSafe: bridge } = useBridge();

    const handleBridge = async () => {
+     if (!walletProvider) return;
-     const result = await bridge.mutateAsync({
-       params: {
-         srcChainId: BASE_MAINNET_CHAIN_ID,
-         srcAsset: '0x...',
-         amount: 1_000_000n,
-         dstChainId: POLYGON_MAINNET_CHAIN_ID,
-         dstAsset: '0x...',
-         recipient: '0x...',
-       },
-     });
-     if (result.ok) {
-       const [spokeTxHash, hubTxHash] = result.value;
-       /* ... */
-     }
+     const result = await bridge({
+       params: {
+         srcChainKey: ChainKeys.BASE_MAINNET,
+         srcAddress,                                  // NEW: required
+         srcAsset: '0x...',
+         amount: 1_000_000n,
+         dstChainKey: ChainKeys.POLYGON_MAINNET,
+         dstAsset: '0x...',
+         dstAddress: '0x...',                         // RENAMED from `recipient`
+       },
+       walletProvider,
+     });
+     if (!result.ok) return;
+     const { srcChainTxHash, dstChainTxHash } = result.value;   // OBJECT, not tuple
    };
  }
```

### `useGetBridgeableAmount` — params + return reshape

```diff
- const { data: amount } = useGetBridgeableAmount({
-   params: {
-     srcChainId: BASE_MAINNET_CHAIN_ID,
-     srcAsset: '0x...',
-     dstChainId: POLYGON_MAINNET_CHAIN_ID,
-     dstAsset: '0x...',
-   },
- });
- if (amount) {
-   <p>Max: {formatUnits(amount, 6)}</p>;   // v1 was bare bigint
- }
+ const { data: result } = useGetBridgeableAmount({
+   params: { from: srcXToken, to: dstXToken },   // each XToken carries chainKey
+ });
+ if (result?.ok) {
+   <p>Max: {formatUnits(result.value.amount, result.value.decimals)}</p>;
+ }
```

### `useGetBridgeableTokens`

```diff
- const { data: tokens } = useGetBridgeableTokens(BASE_MAINNET_CHAIN_ID, POLYGON_MAINNET_CHAIN_ID, srcAsset);
+ const { data: result } = useGetBridgeableTokens({
+   params: { from: ChainKeys.BASE_MAINNET, to: ChainKeys.POLYGON_MAINNET, token: srcAsset },
+ });
+ if (result?.ok) {
+   const tokens: XToken[] = result.value;
+ }
```

### `useBridgeAllowance` / `useBridgeApprove`

`useBridgeAllowance` query inputs (payload + walletProvider) all nest under `params` in v2:

```diff
- const { data: allowanceResult } = useBridgeAllowance({ params, spokeProvider });
+ const { data: isApproved } = useBridgeAllowance({
+   params: { payload: bridgeParams, walletProvider },
+ });
+ // `data` is `boolean | undefined` (already unwrapped).
```

`useBridgeApprove` mutation drops `spokeProvider` from hook init; `mutate(vars)` takes `{ params, walletProvider }`.

## Pitfalls

1. **`useGetBridgeableAmount` data shape changed.** v1 returned bare `bigint`; v2 returns `Result<BridgeLimit>` where `BridgeLimit = { amount, decimals, type }`. UI code that displayed the bigint directly needs `.value.amount`.
2. **Tokens must share the same vault** to be bridgeable. Use `useGetBridgeableTokens` to enumerate compatible destinations — passing an incompatible pair to `bridge()` rejects with `VALIDATION_FAILED`.
3. **`useBridge` return is `TxHashPair`** — destructure as `{ srcChainTxHash, dstChainTxHash }`, not `[a, b]`.
4. **`recipient` field renamed to `dstAddress`** for consistency with the rest of the SDK.

## Cross-references

- [`../../integration/features/bridge.md`](../../integration/features/bridge.md) — v2 reference.
- [`../../integration/recipes/bridge.md`](../../integration/recipes/bridge.md) — full v2 worked example.
- [`../../../../sdk/ai-exported/migration/features/bridge.md`](../../../../sdk/ai-exported/migration/features/bridge.md) — underlying SDK bridge migration.
