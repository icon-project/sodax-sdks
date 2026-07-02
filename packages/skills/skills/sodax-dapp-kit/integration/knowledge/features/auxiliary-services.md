# Auxiliary services — `@sodax/dapp-kit`

Smaller surfaces grouped together: partner fee claiming, recovery, backend queries (read-only data hooks), and shared utilities.

Pair: [`features/auxiliary-services.md`](../../../migration-v1-to-v2/knowledge/features/auxiliary-services.md).

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

### Swaps API (`sodax.api.swaps`)

Typed React Query wrappers over the backend **Swaps API v2** — one `useSwapsApi*` hook per endpoint of `sodax.api.swaps.*` (21 total: tokens, quote, deadline, allowance, approve, create / submit / cancel intent, status, intent hash / packet / extra-data, intent lookups, limit orders, gas estimate, fees, submit-tx + status). They call the backend HTTP API and are distinct from the on-chain `swap/` hooks (`useQuote`/`useStatus`/`useSwap`/…), which drive `sodax.swaps` (the on-chain `SwapService`). Reads take `{ params, queryOptions }`; the six actions (`approve`, `createIntent`, `submitIntent`, `cancelIntent`, `createLimitOrder`, `submitTx`) are mutations taking `{ mutationOptions }`, with domain inputs flowing through `mutate(vars)`.

```ts
// @ai-snippets-skip
useSwapsApiQuote({ params: { body }, queryOptions });   // query    → sodax.api.swaps.getQuote
useSwapsApiSubmitTx({ mutationOptions });               // mutation → sodax.api.swaps.submitTx
useSwapsApiSubmitTxStatus({ params, queryOptions });    // query    → sodax.api.swaps.getSubmitTxStatus
```

`useSwapsApiSubmitTx` is a mutation hook — per-call config (e.g. backend base URL) flows through `mutate(vars)`. The `request` is a `SubmitTxRequestV2` (`{ txHash, srcChainKey, walletAddress, intent, relayData }`):

```ts
// @ai-snippets-skip
const { mutateAsync: submitSwapTx } = useSwapsApiSubmitTx();
// request: SubmitTxRequestV2 — relayData is the string payload; intent carries bigint fields
await submitSwapTx({ request, apiConfig: { baseURL: 'https://...' } });
```

`useSwapsApiSubmitTxStatus` polls the processing status and returns `SubmitTxStatusResponseV2 | undefined`. Its query runs only when **both** `txHash` and `srcChainKey` are supplied — the v2 status endpoint requires the source chain key:

```ts
// @ai-snippets-skip
const { data: status } = useSwapsApiSubmitTxStatus({ params: { txHash, srcChainKey } });
// status?.data?.status: 'pending' | 'relaying' | 'relayed' | 'posting_execution' | 'executed' | 'failed'
```

> The full `useSwapsApi*` hook list (with polling + types) is in [hooks-index.md](../reference/hooks-index.md); key shapes in [querykey-conventions.md](../reference/querykey-conventions.md). For non-React callers, `sodax.api.swaps` is documented in the `sodax-sdk` skill (integration mode).

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
useNearStorageCheck({ params, queryOptions });      // NEP-141 storage registration check (NEAR)
useRegisterNearStorage({ mutationOptions });        // NEP-141 storage_deposit (NEAR)
useNearStorageGate({ dstChainKey, token, accountId, walletProvider }); // composite NEAR receive-side gate
resolveNearStorageGate(chainKey, check);            // unwrapped util: gate-state from a useNearStorageCheck result
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
// useStellarTrustlineCheck reads a trustline (no signing). Pass the resolved Stellar account
// `walletAddress` (e.g. useXAccount('STELLAR').address) — it keys the cache per account, so the
// verdict is never reused across accounts. `chainId` is a `SpokeChainKey` (typed loosely — the hook
// returns `true` for non-Stellar chains, making it safe to gate on conditionally).
const { data: hasTrustline } = useStellarTrustlineCheck({
  params: { token, amount, chainId: ChainKeys.STELLAR_MAINNET, walletAddress },
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

### NEAR storage registration

NEP-141 accounts must pay a one-time storage bond before they can receive a token — delivering to an unregistered account fails. The receive-side analogue of Stellar trustlines: gate any flow that delivers a token to the user on NEAR (swap output on NEAR, bridge into NEAR, money-market borrow/withdraw to NEAR). Use `useNearStorageGate` for app UI; use the lower-level `useNearStorageCheck` + `useRegisterNearStorage` pair when you need custom wiring.

```ts
// @ai-snippets-skip — illustrative only; real types pulled into agents below.
// useNearStorageCheck is a canonical read hook: { params: { token, accountId, chainId }, queryOptions }.
// `chainId` is a SpokeChainKey typed loosely — the hook returns `true` for non-NEAR chains (safe to
// gate conditionally) and `true` for native NEAR (not a NEP-141 token). data is a boolean;
// queryKey: ['shared', 'nearStorageCheck', chainId, token, accountId].
const { data: isRegistered, isLoading } = useNearStorageCheck({
  params: { token, accountId, chainId: ChainKeys.NEAR_MAINNET },
});

// useRegisterNearStorage IS a canonical mutation hook: { mutationOptions }, returns
// SafeUseMutationResult. Domain inputs flow through mutate / mutateAsync / mutateAsyncSafe.
// Vars: { token, accountId, walletProvider, deposit? } — deposit defaults to the NEP-141
// storage bond (0.00125 NEAR). mutationKey: ['shared', 'registerNearStorage'].
const { mutateAsyncSafe: registerStorage } = useRegisterNearStorage();
if (isRegistered === false) {
  await registerStorage({ token, accountId, walletProvider });
}
```

For the common UI path, `useNearStorageGate` returns `{ isNear, needsRegistration, blocksAction, isChecking, isRegistering, registerStorage }`.

Derive UI gate flags with the unwrapped `resolveNearStorageGate` util (no hook) when you need custom check/register composition:

```ts
// @ai-snippets-skip — illustrative only.
// resolveNearStorageGate(chainKey, check) reads `isLoading` + `data` off the useNearStorageCheck
// result and returns { isNear, needsRegistration, blocksAction }:
//   needsRegistration — show the register action (check resolved AND not registered)
//   blocksAction      — keep the downstream action disabled (still checking OR needs registration)
const check = useNearStorageCheck({ params: { token, accountId, chainId: dstChainKey } });
const { needsRegistration, blocksAction } = resolveNearStorageGate(dstChainKey, check);
```

The underlying SDK methods (`isStorageRegistered` / `registerStorage` on the NEAR spoke service, and the `NEAR_STORAGE_DEPOSIT` constant) are documented in the `sodax-sdk` skill (integration mode).

## Default polling intervals

| Hook | Polling | Notes |
|---|---|---|
| `useBackendIntentByTxHash` | 1s | once a `txHash` is supplied (refetch is unconditional, not "while pending") |
| `useSwapsApiSubmitTxStatus` | 1s | requires `txHash` + `srcChainKey`; stops on `executed` / `failed` |
| `useSwapsApiStatus` | 1s | solver intent status; stops on status `3` / `4` |
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
- [`features/auxiliary-services.md`](../../../migration-v1-to-v2/knowledge/features/auxiliary-services.md) — v1 → v2 porting.
- `sodax-sdk`: `integration/knowledge/features/auxiliary-services.md` — underlying SDK auxiliary surfaces (partner, recovery, backendApi).
