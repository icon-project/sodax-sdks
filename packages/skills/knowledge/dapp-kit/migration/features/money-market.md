# Money Market migration — v1 → v2 (dapp-kit)

Pair: [`../../integration/features/money-market.md`](../../integration/features/money-market.md).

## TL;DR

> Cross-cutting conventions (drop `spokeProvider`, single-object hook init, `mutate(vars)` for domain inputs, `mutateAsyncSafe` ergonomics) — see [`../breaking-changes/hook-signatures.md`](../breaking-changes/hook-signatures.md) and [`../breaking-changes/result-handling.md`](../breaking-changes/result-handling.md). Feature-specific deltas below:

1. **`useSupply` / `useBorrow` / `useWithdraw` / `useRepay`** all switch to single-object `{ mutationOptions }` hook init + `mutate({ params, walletProvider })`.
2. **`MoneyMarketSupplyParams<K>` (and the four similar action-param types) gained required `srcChainKey` + `srcAddress`** — SDK-leakage.
3. **`useMMAllowance` auto-skips on-chain checks for borrow/withdraw** — v1 may have had this too, but v2 returns `true` synchronously for those actions instead of issuing a no-op RPC.
4. **`useMMApprove` returns standard `SafeUseMutationResult`** — `isLoading` → `isPending`.
5. **Position / aToken-balance hooks renamed `address` → `userAddress`.** Applies to `useUserFormattedSummary`, `useUserReservesData`, **and `useATokensBalances`** (which also drops `spokeProvider` and adds a required `spokeChainKey` alongside `aTokens` + `userAddress`). `useAToken` is unaffected — it takes only `{ aToken }`.

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

`useBorrow`, `useWithdraw`, `useRepay` follow the same pattern with their respective `action` literals (`'borrow'` / `'withdraw'` / `'repay'`). **All four MM action params share an identical field shape** — only the `action` literal differs:

```ts
// @ai-snippets-skip
// MoneyMarketSupplyParams<K> | MoneyMarketBorrowParams<K> | MoneyMarketWithdrawParams<K> | MoneyMarketRepayParams<K>
{
  srcChainKey: K;                  // required — where the user signs / funds come from
  srcAddress: string;              // required — user's spoke-side address on srcChainKey
  token: string;                   // token on srcChainKey (supply/repay) or on dstChainKey (borrow/withdraw)
  amount: bigint;
  action: 'supply' | 'borrow' | 'withdraw' | 'repay';
  dstChainKey?: SpokeChainKey;     // optional — defaults to srcChainKey (same-chain)
  dstAddress?: string;             // optional — defaults to srcAddress (same-chain)
}
```

Cross-chain delivery via `dstChainKey` / `dstAddress` is supported on **all four** actions, not just borrow/repay. Omit both for same-chain operations.

> **Porting note** — v2 does NOT use `fromChainKey` / `fromAddress` / `toChainKey` / `toAddress` (or `fromChainId` / `toChainId`) on any MM action. Borrow and repay use the **same** `src*` / `dst*` field names as supply and withdraw — the v2 type system unified the cross-chain shape across all four actions. If your v1 call sites or app types carry `from*` / `to*` naming for the spend-chain vs. debt-chain, rename to `src*` / `dst*` (e.g. `fromChainKey → srcChainKey`, `toChainKey → dstChainKey`). See the SDK migration doc cross-link below for explicit borrow/repay diff examples.

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

Same shape on `useUserReservesData`.

### `useATokensBalances`

```diff
- const { data: balances } = useATokensBalances({ aTokens, spokeProvider, userAddress });
+ const { data: balances } = useATokensBalances({
+   params: {
+     aTokens,                                  // readonly Address[]
+     spokeChainKey,                            // SpokeChainKey — NOT `srcChainKey`
+     userAddress,                              // string — spoke-side user address (renamed from `address` if you're porting from any earlier shape)
+   },
+ });
+ // data: Map<Address, bigint> | undefined (already unwrapped — hook throws on SDK !ok)
```

Three things to verify when porting:

- `spokeProvider` is gone — the hook derives the hub wallet internally from `(spokeChainKey, userAddress)` via `EvmHubProvider.getUserHubWalletAddress`.
- The chain-key field is **`spokeChainKey`**, not `srcChainKey`. `src*` names belong to mutation params (`useSupply`/`useBorrow`/etc.) — read hooks for a single-chain position use `spokeChainKey`.
- The user-address field is **`userAddress`**, not `address` — same rename as `useUserFormattedSummary` and `useUserReservesData`.

`useAToken` (metadata-only) is unaffected by the user/chain renames — it takes only `{ aToken }`.

## Pitfalls

1. **`srcAddress` is the user's spoke-side address**, not the hub address. Hub wallet is derived internally.
2. **`useMMAllowance` returns `true` instantly for borrow/withdraw** — don't wait on the query state. Branch on `isApproved` directly.
3. **Cross-chain delivery (all four actions)**: omit `dstChainKey` / `dstAddress` for same-chain. Don't pass `dstChainKey === srcChainKey` (let the default kick in). The field names are `src*` / `dst*` on **every** MM action — there is no `from*` / `to*` variant.
4. **`MoneyMarketSupplyParams<K>` is now generic.** Use `as const` on `srcChainKey` for narrowing: `srcChainKey: ChainKeys.BASE_MAINNET as const`.

## Cross-references

- [`../../integration/features/money-market.md`](../../integration/features/money-market.md) — v2 reference.
- [`../../integration/recipes/money-market.md`](../../integration/recipes/money-market.md) — full v2 worked example.
- [`../breaking-changes/sdk-leakage.md`](../breaking-changes/sdk-leakage.md) — `srcChainKey`/`srcAddress` required.
- [`@sodax/sdk`: `migration/features/money-market.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/knowledge/sdk/migration/features/money-market.md) — underlying SDK MM migration.
