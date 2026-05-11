# Swap migration — v1 → v2 (dapp-kit)

Pair: [`../../integration/features/swap.md`](../../integration/features/swap.md).

## TL;DR

> Cross-cutting conventions (drop `spokeProvider`, single-object hook init, `mutate(vars)` for domain inputs, `mutateAsyncSafe` ergonomics) — see [`../breaking-changes/hook-signatures.md`](../breaking-changes/hook-signatures.md) and [`../breaking-changes/result-handling.md`](../breaking-changes/result-handling.md). Feature-specific deltas below:

1. **Drop `spokeProvider` from `useSwap` and `useSwapApprove` hook init.** Pass `walletProvider` (from `useWalletProvider({ xChainId: chainKey })`) into `mutate(vars)`.
2. **`useSwapAllowance({ params: { payload, srcChainKey, walletProvider } })`** — query inputs all nest under `params` (no top-level `spokeProvider` or `walletProvider`); the SDK request goes under `params.payload`.
3. **Approve hook return shape changed.** `{ approve, isLoading } = useSwapApprove(...)` → `{ mutateAsync: approve, isPending } = useSwapApprove()`.
4. **`mutationFn` throws on SDK `!ok`.** Either wrap `mutateAsync` in `try/catch` or use `mutateAsyncSafe` for `Result<T>` branching.
5. **Field on `Intent` read shape kept its name.** `Intent.srcChain` / `Intent.dstChain` are still `IntentRelayChainId` (bigint) — distinct from request-side `srcChainKey` / `dstChainKey` on action params.
6. **`useStatus({ params: { intentTxHash } })` — single-object query shape.** v1's positional version is gone. Key was renamed `intentHash → intentTxHash`. Return is `Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined` — branch on `data?.ok` before reading status fields.

## Per-method delta

### `useSwap` — execute swap

```diff
  function SwapButton({ intentParams }: { intentParams: CreateIntentParams }) {
-   const swap = useSwap(spokeProvider);
+   const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
+   const { mutateAsyncSafe: swap, isPending } = useSwap();

    const handleSwap = async () => {
+     if (!walletProvider) return;
-     const result = await swap.mutateAsync({ params: intentParams });
-     if (result.ok) {
-       const { intent, intentDeliveryInfo } = result.value;
-       /* ... */
-     } else {
-       toast.error(result.error.message);
-     }
+     const result = await swap({ params: intentParams, walletProvider });
+     if (!result.ok) {
+       toast.error(result.error instanceof Error ? result.error.message : 'Swap failed');
+       return;
+     }
+     const { intent, intentDeliveryInfo } = result.value;
+     /* ... */
    };
  }
```

### `useSwapApprove` — return shape

```diff
- const { approve, isLoading, error } = useSwapApprove(spokeProvider);
- await approve(intentParams);
+ const { mutateAsync: approve, isPending, error } = useSwapApprove();
+ await approve({ params: intentParams, walletProvider });
```

`isLoading` → `isPending` (React Query 5 convention).

### `useSwapAllowance` — payload + srcChainKey + walletProvider all under `params`

```diff
- const { data: allowanceResult } = useSwapAllowance({ params: intentParams, spokeProvider });
+ const { data: isApproved } = useSwapAllowance({
+   params: { payload: intentParams, srcChainKey: ChainKeys.BSC_MAINNET, walletProvider },
+ });
+ // `data` is `boolean | undefined` (already unwrapped); no `.ok` branch needed.
```

### `useStatus` — single-object shape + param renamed `intentHash → intentTxHash`

```diff
- const { data: status } = useStatus(intentHash);
+ const { data: status } = useStatus({ params: { intentTxHash } });
+ // `data` is `Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined` —
+ // branch on `data?.ok` before reading `data.value.<fields>`.
```

### `useQuote` — single-object shape + SDK request nested under `params.payload`

```diff
- const { data: quote } = useQuote({
-   token_src: SRC_TOKEN,
-   token_dst: DST_TOKEN,
-   token_src_blockchain_id: BSC_MAINNET_CHAIN_ID,
-   token_dst_blockchain_id: ARBITRUM_MAINNET_CHAIN_ID,
-   amount,
-   quote_type: 'exact_input',
- });
+ const { data: quote } = useQuote({
+   params: {
+     payload: {
+       token_src: SRC_TOKEN,
+       token_dst: DST_TOKEN,
+       token_src_blockchain_id: ChainKeys.BSC_MAINNET,
+       token_dst_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
+       amount,
+       quote_type: 'exact_input',
+     },
+   },
+ });
```

`SolverIntentQuoteRequest` shape unchanged. Two v2 changes: SDK request is nested under `params.payload` (not directly under `params`); constants renamed (`*_MAINNET_CHAIN_ID` → `ChainKeys.X_MAINNET`).

### `useCreateLimitOrder` / `useCancelLimitOrder` / `useCancelSwap`

Same shape changes as `useSwap` — drop `spokeProvider`, move domain inputs to `mutate(vars)`.

## Pitfalls

1. **`Intent.srcChain` / `Intent.dstChain` look like they should rename.** They didn't. Those are read-shape `IntentRelayChainId` (bigint), distinct from request-side `srcChainKey` / `dstChainKey`. Don't grep-replace.
2. **`useStatus` polling default.** v2 polls every 3 s unconditionally once `intentTxHash` is supplied (it does not auto-stop on terminal states — your UI should disable rendering when no longer needed, or override `queryOptions.refetchInterval: false`). Port any v1 custom polling to `queryOptions.refetchInterval`.
3. **`useQuote` data is `Result<T>`** — branch on `data?.ok` before reading `data.value.quoted_amount`.

## Cross-references

- [`../../integration/features/swap.md`](../../integration/features/swap.md) — v2 reference.
- [`../../integration/recipes/swap.md`](../../integration/recipes/swap.md) — full v2 worked example.
- [`../breaking-changes/hook-signatures.md`](../breaking-changes/hook-signatures.md), [`../breaking-changes/result-handling.md`](../breaking-changes/result-handling.md) — cross-cutting deltas.
- [`../../../../sdk/ai-exported/migration/features/swap.md`](../../../../sdk/ai-exported/migration/features/swap.md) — underlying SDK swap migration.
