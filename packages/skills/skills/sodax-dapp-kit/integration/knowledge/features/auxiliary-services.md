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

These hooks forward the body verbatim, so `partnerFee` has no default (SDK fee config does not
apply). Put the same value on quote and create-intent:

```ts
// @ai-snippets-skip
const partnerFee = { address: '0xSonicFeeReceiver', percentage: 10 }; // 10 = 0.1% (bps)
const { data: quote } = useSwapsApiQuote({ params: { body: { ...quoteBody, partnerFee } } });
await createIntent({ body: { ...intentBody, partnerFee } });
```

See the `sodax-sdk` skill (integration mode), `swaps-api.md` § `partnerFee`.

### API key (`x-api-key`)

The backend guards `POST /swaps/*` with an API-key check. Configure the key once on the provider config
— `<SodaxProvider config={{ apiKey }}>` (global) or `config={{ swaps: { apiKey } }}` (feature override)
— and every `sodax.api.swaps` call these hooks make carries it. Override per request via the hooks'
existing `apiConfig` param (`RequestOverrideConfig`), which also accepts `apiKey`:

```ts
// @ai-snippets-skip
const { data: quote } = useSwapsApiQuote({
  params: { body: quoteBody, apiConfig: { apiKey: 'partner-api-key' } },
});
```

Never put the key in a `queryKey` (the hooks already exclude `apiConfig` from their keys). Auth failures
surface with `context.status` `401`/`403` — nothing but a corrected key fixes them, so treat them as
terminal in your UI; the transient verification `503` is retried by the wire client. See the
`sodax-sdk` skill (integration mode), `swaps-api.md` § API key, for the precedence order.

Every `useSwapsApi*` hook already handles this: its default `retry` is `retryUnlessAuthFailure`
(exported from `@sodax/dapp-kit`), which retries transport blips up to 3 times but never replays a
401/403. `useSwapsApiStatus` and `useSwapsApiSubmitTxStatus` additionally stop their 1s poll on a
rejected key, instead of re-requesting forever. So an invalid key surfaces once, fast, on `error`.

Override or compose it through `queryOptions` / `mutationOptions` when you want different behaviour:

```ts
// @ai-snippets-skip
const { data: quote } = useSwapsApiQuote({
  params: { body: quoteBody },
  queryOptions: { retry: (count, error) => !isAuthFailure(error) && count < 5 },
});
```

`isAuthFailure` (re-exported from `@sodax/sdk`) is the same guard the default uses — prefer it over
re-deriving `context.status`, so your UI and the hooks agree on what counts as terminal.

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
// status?.data?.status: 'pending' | 'relaying' | 'relayed' | 'posting_execution' | 'posted_execution' | 'solved' | 'failed'
```

> The full `useSwapsApi*` hook list (with polling + types) is in [hooks-index.md](../reference/hooks-index.md); key shapes in [querykey-conventions.md](../reference/querykey-conventions.md). For non-React callers, `sodax.api.swaps` is documented in the `sodax-sdk` skill (integration mode).

### Bridge API (`sodax.api.bridge`)

Typed React Query wrappers over the backend **Bridge API v2** — `useBridgeApi*` hooks over `sodax.api.bridge.*` (tokens, allowance, approve, create-bridge-intent, submit-tx + status, plus the fee / bridgeable-amount / bridgeable discovery quotes). They are the HTTP-API parallel of the on-chain `bridge/` hooks (`useBridge`/`useBridgeAllowance`/…, which drive `sodax.bridge`). Mirrors the swaps family minus the solver/intent surface; reads take `{ params, queryOptions }`, the three actions (`approve`, `createBridgeIntent`, `submitTx`) are mutations taking `{ mutationOptions }`.

```ts
// @ai-snippets-skip
useBridgeApiTokens({ params, queryOptions });           // query    → sodax.api.bridge.getTokens
useBridgeApiCreateBridgeIntent({ mutationOptions });    // mutation → sodax.api.bridge.createBridgeIntent
useBridgeApiSubmitTxStatus({ params, queryOptions });   // query    → sodax.api.bridge.getSubmitTxStatus
```

Two deltas vs the swaps hooks: the allowance/approve/create body is the **wire DTO** `CreateBridgeIntentParamsV2` (`inputToken`/`inputAmount`/`dstAddress`, not the SDK-domain names), and `useBridgeApiSubmitTx`'s `request` is a `BridgeSubmitTxRequestV2` whose `relayData` is the **FULL `{ address, payload }` object** (no `intent` field):

```ts
// @ai-snippets-skip
const { mutateAsync: submitBridgeTx } = useBridgeApiSubmitTx();
// request: BridgeSubmitTxRequestV2 — { txHash, srcChainKey, walletAddress, relayData } (full envelope)
await submitBridgeTx({ request, apiConfig: { baseURL: 'https://...' } });
```

`useBridgeApiSubmitTxStatus` polls (1s) and returns `BridgeSubmitTxStatusResponseV2 | undefined`, running only when **both** `txHash` and `srcChainKey` are supplied; terminal states are `executed` / `failed` (no `posting_execution`). The fee / bridgeable-amount / bridgeable quotes are computable client-side (config + vault math) — prefer the on-chain `useGetBridgeableAmount` / `sodax.bridge.*` for a no-round-trip read; `useBridgeApiFee` / `useBridgeApiBridgeableAmount` / `useBridgeApiIsBridgeable` mirror the backend endpoints for HTTP parity.

> Full list in [hooks-index.md](../reference/hooks-index.md); key shapes in [querykey-conventions.md](../reference/querykey-conventions.md). For non-React callers, `sodax.api.bridge` is documented in the `sodax-sdk` skill (integration mode).

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
useEstablishTrustline({ mutationOptions });         // useRequestTrustline is its deprecated 2.0.0 wrapper
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

### Stellar prerequisites — use `useStellarGate`

Stellar has ordered prerequisites for a destination account, and they are invisible until they bite:
the account must **exist** on-chain, must **trust** the destination token, and — only if it does not —
must be able to **pay** for the trustline it needs. `useStellarGate` sequences them; prefer it over
wiring the pieces yourself.

```ts
// @ai-snippets-skip — illustrative only; real types pulled into agents below.
// Mirrors useNearStorageGate. Pass the DESTINATION chain/token/amount/account plus the destination
// wallet provider; the gate owns the `=== STELLAR_MAINNET` test and the native-token exemption.
const stellar = useStellarGate({ dstChainKey, token, amount, address, walletProvider });

// Exactly one of these is ever true, in this order:
if (stellar.needsActivation) await stellar.activate();        // account does not exist — sponsor pays
if (stellar.needsFunding) { /* send it XLM — needs no trustline */ }
if (stellar.needsTrustline) await stellar.requestTrustline();

// A check FAILED — state unknown, not unmet. Say so and offer the retry; otherwise the action is
// disabled with nothing on screen explaining why.
if (stellar.checkFailed) { /* render stellar.error?.message + a button calling stellar.retry() */ }

// Gate the downstream action on the whole gate, which also covers the checking and errored windows.
const disabled = stellar.blocksAction || /* … */ false;
```

Affordability is checked **after** the trustline, and the order matters: an account that already trusts
the asset needs no XLM, because the sender pays the fee and the subentry reserve is already locked.
Checking affordability first blocks a correctly-configured user who has merely spent their spendable
XLM, and tells them to fund an account that needs nothing.

`blocksAction` is fail-closed on an unknown state, deliberately: a payment to a non-existent account, or
of an untrusted asset, fails on-chain, so letting the action through on a failed check risks stranding
funds. That makes `checkFailed` load-bearing — it is the only way a UI can tell "we could not check"
apart from "you are missing something", and without it a transient Horizon failure reads to the user as
an inexplicably dead button.

Do NOT hand-roll this as `useStellarTrustlineCheck` + `useEstablishTrustline`. `hasSufficientTrustline`
**throws** for an account that does not exist, so a `!data` test reads a missing account as "needs a
trustline" and offers a button that cannot work. Read `isLoading`, never `isPending` — `isPending` stays
`true` for a disabled query and blocks forever.

The lower-level pieces remain available for custom wiring: `useStellarAccountStatus` (existence,
`canAffordTrustline`, and `trustlineMinXlmStroops` — the XLM one more trustline needs at the network's
current base reserve — from one Horizon account read), `useStellarAccountActive` (existence only),
`useStellarTrustlineCheck`, and `useEstablishTrustline` — a canonical mutation hook whose vars are
`{ token, amount, srcChainKey, walletProvider }` (NOT `account` / `asset`). `useRequestTrustline` still
exists as a deprecated wrapper preserving the 2.0.0 shape (`{ requestTrustline, isLoading, isRequested,
error, data }`, positional token ignored); write new code against `useEstablishTrustline`.

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

## Stellar account activation (sponsoring)

A Stellar account must exist on-chain before it can hold or receive anything, and a brand-new user
holds 0 XLM. The SODAX sponsoring service pays the account's base reserve via Stellar's
sponsored-reserve flow. **The user's own wallet must sign** — their signature is what authorises the
`endSponsoringFutureReserves` operation — so this can never be a server-only call.

```ts
// @ai-snippets-skip
useStellarAccountActive({ params: { address }, queryOptions });   // does the account exist on-chain?
useSponsorConfig({ queryOptions });                               // sponsor account, network, fee band
useActivateStellarAccount({ mutationOptions });                   // activate via the sponsor
```

Mutation vars:

```ts
// @ai-snippets-skip
// An alias for the SDK's own params — every option the service accepts is accepted here.
type UseActivateStellarAccountVars = ActivateStellarAccountParams;
//   address: string                        // must be the account walletProvider signs with
//   walletProvider: IStellarWalletProvider // useWalletProvider({ xChainId: ChainKeys.STELLAR_MAINNET })
//   allowSequenceRetry?: boolean           // default true — one rebuild + re-sign on a sequence conflict
//   maxHorizonRetries?: number             // default 2 — no-prompt re-submits of the SAME payload
//   onSignatureRequired?: (info: { attempt: 1 | 2; reason: 'initial' | 'sequenceConflict' }) => void
//   forceConfigRefresh?: boolean
//   requestConfig?: RequestOverrideConfig
```

Four things consumers get wrong:

1. **Activation makes the account able to RECEIVE, not to SEND.** A freshly activated account holds
   **zero spendable XLM** (the sponsor covers its reserve; `startingBalance` is `0`), so it cannot pay a
   fee or the reserve its own first trustline would lock. Use `useStellarGate`, which sequences
   activation → trustline → funding; pairing `useStellarTrustlineCheck` with `useEstablishTrustline`
   directly conflates "account missing" with "trustline missing" and offers a button that cannot work.
   Always render `checkFailed` / `error` / `retry` too — a fail-closed gate that cannot explain itself
   is a dead button.

2. **`alreadyActive` is a SUCCESS, not a no-op failure.** The result is
   `{ status: 'submitted', hash, attempts }` or `{ status: 'alreadyActive', hash: null, attempts }`.
   Render the second as "already active", not as an error. `attempts: 0` means the client pre-flight
   caught it and the user was never prompted.
3. **A sequence conflict costs a SECOND wallet prompt.** The sponsor's sequence number is baked into
   the signed payload, so if another activation lands first the transaction must be rebuilt and
   re-signed. Wire `onSignatureRequired` and show the explanation *before* the wallet steals focus —
   it fires immediately before each prompt.
4. **Never hardcode the sponsor account.** It comes from `useSponsorConfig` / the SDK's own fetch,
   which is what makes sponsor rotation a config change instead of a client release.

Failure handling: `error.context.nextAction` carries the caller's next step —
`fixIntegration` | `checkApiKey` | `rebuildAndResign` | `retrySameRequest` | `backoff` |
`contactOperator` | `abort` — alongside `retryable` and `requiresNewSignature`. Branch on those
rather than on the HTTP status.

When the server rate-limits a key it also supplies `error.context.retryAfterSeconds`; render "try again
in Ns" instead of a generic "try later". The SDK never auto-retries a rate limit.

Requires `api.sponsoringApiConfig` (at minimum `apiKey`) on the `SodaxProvider` config. An api key
in a browser bundle is public by nature; the service's per-key quotas, fleet cap, per-IP throttle,
and origin gating are the real controls. Proxy through your own backend if that is not acceptable.

## Default polling intervals

| Hook | Polling | Notes |
|---|---|---|
| `useBackendIntentByTxHash` | 1s | once a `txHash` is supplied (refetch is unconditional, not "while pending") |
| `useSwapsApiSubmitTxStatus` | 1s | requires `txHash` + `srcChainKey`; stops on `solved` / `failed` |
| `useSwapsApiStatus` | 1s | solver intent status; stops on status `3` / `4` |
| `useBackendOrderbook` | none | `staleTime: 30s` — fresh-window, no background refetch |
| `useExpiredUtxos` (bitcoin) | 60s | refetchInterval |
| `useQuote` (swap) | 3s | refetchInterval |
| `useStatus` (swap) | 3s | stops on status `3`/`4`, and after 40 consecutive NOT_FOUND fetches |
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
