# Money Market migration — v1 → v2 (dapp-kit)

Pair: [`../../integration/features/money-market.md`](../../integration/features/money-market.md).

## TL;DR

> Cross-cutting conventions (drop `spokeProvider`, single-object hook init, `mutate(vars)` for domain inputs, `mutateAsyncSafe` ergonomics) — see [`../breaking-changes/hook-signatures.md`](../breaking-changes/hook-signatures.md) and [`../breaking-changes/result-handling.md`](../breaking-changes/result-handling.md). Feature-specific deltas below:

1. **`useSupply` / `useBorrow` / `useWithdraw` / `useRepay`** all switch to single-object `{ mutationOptions }` hook init + `mutate({ params, walletProvider })`.
2. **`MoneyMarketSupplyParams<K>` (and the four similar action-param types) gained required `srcChainKey` + `srcAddress`** — SDK-leakage.
3. **`useMMAllowance` auto-skips on-chain checks for borrow/withdraw** — v1 may have had this too, but v2 returns `true` synchronously for those actions instead of issuing a no-op RPC.
4. **`useMMApprove` returns standard `SafeUseMutationResult`** — `isLoading` → `isPending`.
5. **Reserve data hooks renamed `address` → `userAddress`** in some queries (`useUserFormattedSummary`, `useUserReservesData`).

## Per-method delta

### `useSupply` (and `useBorrow` / `useWithdraw` / `useRepay`)

```diff
  function SupplyButton({ token, amount, srcAddress }) {
-   const supply = useSupply(spokeProvider);
+   const walletProvider = useWalletProvider({ xChainId: ChainKeys.BASE_MAINNET });
+   const { mutateAsyncSafe: supply, isPending } = useSupply();

    const handleSupply = async () => {
+     if (!walletProvider) return;
-     const result = await supply.mutateAsync({ params: { token, amount, action: 'supply' } });
-     if (result.ok) {
-       const txHashPair = result.value;
-       /* ... */
-     }
+     const result = await supply({
+       params: {
+         srcChainKey: ChainKeys.BASE_MAINNET,                  // NEW: required
+         srcAddress,                                           // NEW: required
+         token,
+         amount,
+         action: 'supply',
+       },
+       walletProvider,
+     });
+     if (!result.ok) return;
+     const { srcChainTxHash, dstChainTxHash } = result.value;  // TxHashPair
    };
  }
```

`useBorrow`, `useWithdraw`, `useRepay` follow the same pattern with their respective `action` literals (`'borrow'` / `'withdraw'` / `'repay'`). Borrow + repay can specify optional `dstChainKey` / `dstAddress` for cross-chain delivery.

### `useMMAllowance` — auto-skip

```diff
- const { data: isApproved } = useMMAllowance({ params, spokeProvider });
+ const { data: isApproved } = useMMAllowance({ params: { payload: params } });
+ // No walletProvider — read-only (SDK call uses `raw: true` internally).
+ // For borrow/withdraw actions, returns `true` synchronously (no RPC call).
+ // For supply/repay, reads on-chain allowance.
```

### `useMMApprove`

```diff
- const { approve, isLoading } = useMMApprove(spokeProvider);
- await approve(params);
+ const { mutateAsync: approve, isPending } = useMMApprove();
+ await approve({ params, walletProvider });
```

### Reserve data hooks

Most got the single-object shape:

```diff
- const { data } = useReservesData({ ...refetchOptions });
+ const { data } = useReservesData({ queryOptions: { ...refetchOptions } });
```

User-position hooks renamed param fields:

```diff
- const { data } = useUserFormattedSummary({ spokeChainKey, address: userAddress });
+ const { data } = useUserFormattedSummary({ params: { spokeChainKey, userAddress } });
```

## Pitfalls

1. **`srcAddress` is the user's spoke-side address**, not the hub address. Hub wallet is derived internally.
2. **`useMMAllowance` returns `true` instantly for borrow/withdraw** — don't wait on the query state. Branch on `isApproved` directly.
3. **Cross-chain borrow/repay**: omit `dstChainKey` / `dstAddress` for same-chain. Don't pass `dstChainKey === srcChainKey` (let the default kick in).
4. **`MoneyMarketSupplyParams<K>` is now generic.** Use `as const` on `srcChainKey` for narrowing: `srcChainKey: ChainKeys.BASE_MAINNET as const`.

## Cross-references

- [`../../integration/features/money-market.md`](../../integration/features/money-market.md) — v2 reference.
- [`../../integration/recipes/money-market.md`](../../integration/recipes/money-market.md) — full v2 worked example.
- [`../breaking-changes/sdk-leakage.md`](../breaking-changes/sdk-leakage.md) — `srcChainKey`/`srcAddress` required.
- [`../../../../sdk/ai-exported/migration/features/money-market.md`](../../../../sdk/ai-exported/migration/features/money-market.md) — underlying SDK MM migration.
