# Auxiliary services migration — v1 → v2 (dapp-kit)

Pair: [`../../integration/features/auxiliary-services.md`](../../integration/features/auxiliary-services.md).

Smaller surfaces grouped together: partner, recovery, backend queries, shared utilities. Most changes are mechanical — single-object params, mutateAsyncSafe — same as the other features.

## Partner

```diff
- const claim = useFeeClaimSwap(spokeProvider);
- await claim.mutateAsync(params);
+ const walletProvider = useWalletProvider({ xChainId: ChainKeys.SONIC_MAINNET });
+ const { mutateAsyncSafe: claim } = useFeeClaimSwap();
+ const result = await claim({ params, walletProvider });
```

`useApproveToken`, `useSetSwapPreference` — same pattern.

`useFetchAssetsBalances`, `useGetAutoSwapPreferences`, `useIsTokenApproved` — convert to single-object query shape.

## Recovery

```diff
- const withdraw = useWithdrawHubAsset(spokeProvider);
+ const { mutateAsyncSafe: withdraw } = useWithdrawHubAsset();
+ await withdraw({ params, walletProvider });
```

## Backend queries

Read-only. No `walletProvider` involved. Convert to single-object query shape.

```diff
- const { data: intent } = useBackendIntentByTxHash(txHash);
+ const { data: intent } = useBackendIntentByTxHash({ params: { txHash } });

- const { data: orderbook } = useBackendOrderbook({ offset: '0', limit: '20' });
+ const { data: orderbook } = useBackendOrderbook({ pagination: { offset: '0', limit: '20' } });

- const { data: position } = useBackendMoneyMarketPosition(userAddress);
+ const { data: position } = useBackendMoneyMarketPosition({ params: { userAddress } });

- const { data: assets } = useBackendAllMoneyMarketAssets();
+ const { data: assets } = useBackendAllMoneyMarketAssets({});
```

`useBackendSubmitSwapTx` is a mutation — per-call config flows through `mutate(vars)`:

```diff
- const submit = useBackendSubmitSwapTx({ baseURL: 'https://...' });   // v1: per-instance config
- await submit.mutateAsync(swapPayload);
+ const { mutateAsync: submit } = useBackendSubmitSwapTx();
+ await submit({ request: swapPayload, apiConfig: { baseURL: 'https://...' } });   // v2: per-call config
```

## Shared utilities

### `useXBalances`

v2 requires four fields under `params`: `xService` (from `@sodax/wallet-sdk-react`), `xChainId`, `xTokens`, and `address`. The token list is no longer optional.

```diff
- const { data: balances } = useXBalances(BSC_MAINNET_CHAIN_ID, address, tokens);
+ import { useXService, getXChainType } from '@sodax/wallet-sdk-react';
+ const xChainId = ChainKeys.BSC_MAINNET;
+ const xService = useXService({ xChainType: getXChainType(xChainId) });
+ const { data: balances } = useXBalances({
+   params: { xService, xChainId, xTokens, address },
+ });
```

Note: the request param is still `xChainId` (not renamed to `chainKey`). This is intentional — `xChainId` overlays the cross-chain abstraction; the rename only happened for token-side fields. Don't conflate.

### `useEstimateGas`

```diff
- const estimate = useEstimateGas(walletProvider);
- await estimate.mutateAsync({ rawTx });
+ const { mutateAsyncSafe: estimateGas } = useEstimateGas();
+ const result = await estimateGas({ rawTx, walletProvider });
```

### `useStellarTrustlineCheck` / `useRequestTrustline`

```diff
- const { data: hasTrustline } = useStellarTrustlineCheck(account, asset);
+ const { data: hasTrustline } = useStellarTrustlineCheck({ params: { account, asset } });

- const request = useRequestTrustline(walletProvider);
- await request.mutateAsync({ account, asset });
+ const { mutateAsync: request } = useRequestTrustline();
+ await request({ account, asset, walletProvider });
```

### `useDeriveUserWalletAddress` / `useGetUserHubWalletAddress`

```diff
- const { data: hubAddress } = useDeriveUserWalletAddress(spokeChainKey, srcAddress);
+ const { data: hubAddress } = useDeriveUserWalletAddress({ params: { spokeChainKey, srcAddress } });
```

## Pitfalls

1. **`useBackendIntentByTxHash` polls every 1s while pending** — same as v1, but make sure your `queryOptions.refetchInterval` overrides if needed.
2. **`useBackendOrderbook` does NOT auto-refetch** — it has `staleTime: 30s` only, so data stays fresh for 30s after a fetch but won't refresh on its own. Trigger a refetch manually or pass `refetchInterval` via `queryOptions` if you need polling.
3. **`useXBalances` uses `xChainId` (not `chainKey`)** — request-side field name retained on this hook.
4. **`useBackendSubmitSwapTx` config moved to per-call.** v1 may have had `baseURL` at hook init; v2 puts it in `mutate(vars).apiConfig`. Lets you have a single hook serve multiple backends if needed.

## Cross-references

- [`../../integration/features/auxiliary-services.md`](../../integration/features/auxiliary-services.md) — v2 reference.
- [`../../integration/recipes/backend-queries.md`](../../integration/recipes/backend-queries.md) — backend hooks worked examples.
- [`../../integration/recipes/wallet-connectivity.md`](../../integration/recipes/wallet-connectivity.md) — `useXBalances` worked example.
- [`../../../sdk/migration/features/auxiliary-services.md`](../../../sdk/migration/features/auxiliary-services.md) — underlying SDK auxiliary migrations.
