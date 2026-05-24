# Auxiliary services — `@sodax/dapp-kit`

Smaller surfaces grouped together: partner fee claiming, recovery, backend queries (read-only data hooks), and shared utilities.

Pair: [`../../migration/features/auxiliary-services.md`](../../migration/features/auxiliary-services.md).

## Partner

Partner fee claiming and auto-swap preferences.

```ts
// @ai-snippets-skip
useFetchAssetsBalances({ params, queryOptions });   // Partner asset balances
useGetAutoSwapPreferences({ params, queryOptions });
useIsTokenApproved({ params: { payload: FeeTokenApproveParams }, queryOptions });
useApproveToken({ mutationOptions });
useSetSwapPreference({ mutationOptions });
useFeeClaimSwap({ mutationOptions });               // Claim partner fees via swap
```

`useFeeClaimSwap` returns `SafeUseMutationResult<IntentAutoSwapResult, Error, UseFeeClaimSwapVars>` — the success value is `IntentAutoSwapResult` (NOT `SwapResponse`). TVars are `Omit<PartnerFeeClaimSwapAction<HubChainKey, false>, 'raw'>`.

## Recovery

Withdraw stuck hub-wallet assets back to a spoke chain.

```ts
// @ai-snippets-skip
useHubAssetBalances({ params, queryOptions });      // List assets stuck on hub
useWithdrawHubAsset({ mutationOptions });
```

## Backend queries (read-only data)

No wallet connection required.

### Intent tracking

```ts
// @ai-snippets-skip
useBackendIntentByTxHash({ params, queryOptions });   // Polls 1s once a txHash is supplied
useBackendIntentByHash({ params, queryOptions });
useBackendUserIntents({ params, queryOptions });      // Date-filtered user history; data is { items: IntentResponse[], total, offset, limit }
```

### Orderbook

```ts
// @ai-snippets-skip
// `pagination` MUST be nested under `params` — top-level pagination is invalid.
useBackendOrderbook({ params: { pagination: { offset, limit } }, queryOptions });   // staleTime 30s; no auto-refresh
```

### Money market data

```ts
// @ai-snippets-skip
useBackendMoneyMarketPosition({ params, queryOptions });
useBackendMoneyMarketAsset({ params, queryOptions });
useBackendAllMoneyMarketAssets({ queryOptions });
useBackendMoneyMarketAssetSuppliers({ params, queryOptions });
useBackendMoneyMarketAssetBorrowers({ params, queryOptions });
// Pagination required — without it the query is disabled.
useBackendAllMoneyMarketBorrowers({ params: { pagination: { offset, limit } }, queryOptions });
```

### Swap submission

```ts
// @ai-snippets-skip
useBackendSubmitSwapTx({ mutationOptions });           // Mutation
useBackendSubmitSwapTxStatus({ params, queryOptions }); // Query — check submitted status
```

`useBackendSubmitSwapTx` is a mutation hook — per-call config (e.g. backend base URL) flows through `mutate(vars)`:

```ts
// @ai-snippets-skip
const { mutateAsync: submitSwapTx } = useBackendSubmitSwapTx();
await submitSwapTx({ request: swapPayload, apiConfig: { baseURL: 'https://...' } });
```

## Shared utilities

Cross-cutting hooks used by other features.

```ts
// @ai-snippets-skip
useSodaxContext();                                  // Access the Sodax SDK instance
useHubProvider();                                   // Hub chain (Sonic) provider
useXBalances({ params, queryOptions });             // Cross-chain token balances
useDeriveUserWalletAddress({ params, queryOptions }); // Hub wallet address (CREATE3)
useGetUserHubWalletAddress({ params, queryOptions }); // Hub wallet via wallet router
useEstimateGas({ mutationOptions });                // Gas estimation for raw tx
useStellarTrustlineCheck({ params, queryOptions });
useRequestTrustline({ mutationOptions });
```

### `useXBalances` shape

```ts
// @ai-snippets-skip
type UseXBalancesParams = ReadHookParams<Record<string, bigint>, {
  xService: IXServiceBase | undefined;       // From @sodax/wallet-sdk-react's useXService
  xChainId: SpokeChainKey | undefined;
  xTokens: readonly XToken[];                // Tokens to fetch balances for
  address: string | undefined;
}>;
```

Note: the **request-side** field is `xChainId` (kept for the cross-chain abstraction it overlays). This is distinct from the v2-renamed token-side `chainKey` — don't conflate them.

Consumer must supply `xService` from `@sodax/wallet-sdk-react`:

```tsx
// @ai-snippets-skip
import { useXService, getXChainType } from '@sodax/wallet-sdk-react';
const xService = useXService({ xChainType: getXChainType(xChainId) });
const { data: balances } = useXBalances({ params: { xService, xChainId, xTokens, address } });
```

### Stellar trustlines

Stellar accounts that have never held an asset have no trustline — receiving will fail. Pre-flight with `useStellarTrustlineCheck`; fix with `useRequestTrustline`:

```ts
// @ai-snippets-skip — illustrative only; real types pulled into agents below.
// useStellarTrustlineCheck takes { token, amount, chainId, walletProvider } under params.
// `chainId` here is a `SpokeChainKey` (typed loosely so consumers can pass any chain key —
// the hook returns `true` for non-Stellar chains, making it safe to gate on conditionally).
const { data: hasTrustline } = useStellarTrustlineCheck({
  params: { token, amount, chainId: ChainKeys.STELLAR_MAINNET, walletProvider },
});

// useRequestTrustline is NOT a canonical mutation hook — it takes a single positional
// `token` arg and returns { requestTrustline, isLoading, isRequested, error, data }.
// The `requestTrustline` callback signature is:
//   ({ token, amount, srcChainKey, walletProvider }) => Promise<string>
// NOTE: fields are `token` / `amount` / `srcChainKey` / `walletProvider` — NOT
// `account` / `asset`. Pass a StellarChainKey for srcChainKey.
const { requestTrustline, isLoading } = useRequestTrustline(token);
if (hasTrustline === false) {
  await requestTrustline({ token, amount, srcChainKey: ChainKeys.STELLAR_MAINNET, walletProvider });
}
```

## Default polling intervals

| Hook | Polling | Notes |
|---|---|---|
| `useBackendIntentByTxHash` | 1s | once a `txHash` is supplied (refetch is unconditional, not "while pending") |
| `useBackendSubmitSwapTxStatus` | varies | poll stops on `executed` / `failed` |
| `useBackendOrderbook` | none | `staleTime: 30s` — fresh-window, no background refetch |
| `useExpiredUtxos` (bitcoin) | 60s | refetchInterval |
| `useQuote` (swap) | 3s | refetchInterval |
| `useStatus` (swap) | 3s | refetchInterval |
| `useSwapAllowance` (swap) | 2s | refetchInterval |
| `useMMAllowance` (mm) | 5s | refetchInterval; `enabled: false` for borrow/withdraw actions |
| Reserves data (mm) | 5s | `useReservesData` / `useReservesHumanized` / user position hooks |
| Most others | None | |

All overridable via `queryOptions.refetchInterval`.

## Cross-references

- [`../recipes/backend-queries.md`](../recipes/backend-queries.md) — worked examples for intent tracking, orderbook, MM data.
- [`../recipes/wallet-connectivity.md`](../recipes/wallet-connectivity.md) — `useXBalances` worked example.
- [`../../migration/features/auxiliary-services.md`](../../migration/features/auxiliary-services.md) — v1 → v2 porting.
- [`@sodax/sdk`: `integration/features/auxiliary-services.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/skills/knowledge/sdk/integration/features/auxiliary-services.md) — underlying SDK auxiliary surfaces (partner, recovery, backendApi).
