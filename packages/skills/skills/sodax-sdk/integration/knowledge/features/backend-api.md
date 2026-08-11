# Backend API — `BackendApiService`

HTTP client for backend services. Provides intent lookup, solver orderbook queries, money-market position/reserve reads, and (internally) config fetching. Most consumer-side code uses just `getIntentByHash` / `getIntentByTxHash` and the money-market read methods. Swap-tx submission lives on the sibling swaps API client — `sodax.api.swaps.submitTx` (see below).

Access: `sodax.backendApi`. Service class: `BackendApiService`. **Feature tag for errors:** every method emits `feature: 'backend'` with `error.context.api: 'backend'` (the HTTP-client layer — the domain feature tags like `'moneyMarket'` belong to the on-chain services, not these backend reads).

## Methods

```ts
// Swap-related reads
sodax.backendApi.getOrderbook(...): Promise<Result<OrderbookResponse>>; // object: { total: number; data: Array<{ intentState, intentData }> } — NOT an array
sodax.backendApi.getIntentByHash(intentHash, config?): Promise<Result<IntentResponse>>;
sodax.backendApi.getIntentByTxHash(txHash, config?): Promise<Result<IntentResponse>>;
sodax.backendApi.getUserIntents(...): Promise<Result<UserIntentsResponse>>; // { total, offset, limit, items: IntentResponse[] } — intents under .items

// Swap-tx submission — on the swaps API client (sodax.api.swaps), not BackendApiService
sodax.api.swaps.submitTx(request, config?): Promise<Result<SubmitTxResponseV2>>;
sodax.api.swaps.getSubmitTxStatus(query, config?): Promise<Result<SubmitTxStatusResponseV2>>;

// Money-market reads (these are the canonical reads for MM positions/reserves;
// MoneyMarketService does NOT expose getReservesData / getUserReservesData / etc.)
sodax.backendApi.getMoneyMarketPosition(...): Promise<Result<...>>;
sodax.backendApi.getAllMoneyMarketAssets(config?): Promise<Result<MoneyMarketAsset[]>>;
sodax.backendApi.getMoneyMarketAsset(reserveAddress, config?): Promise<Result<MoneyMarketAsset>>;
sodax.backendApi.getMoneyMarketAssetBorrowers(...): Promise<Result<...>>;
sodax.backendApi.getMoneyMarketAssetSuppliers(...): Promise<Result<...>>;
sodax.backendApi.getAllMoneyMarketBorrowers(...): Promise<Result<...>>;

// Config-API methods (used internally by ConfigService — implements `IConfigApiV1`)
sodax.backendApi.getAllConfig(config?): Promise<Result<GetAllConfigApiResponse>>;
sodax.backendApi.getChains(config?): Promise<Result<GetChainsApiResponse>>;
sodax.backendApi.getSwapTokens(config?): Promise<Result<GetSwapTokensApiResponse>>;
sodax.backendApi.getSwapTokensByChainId(...): Promise<Result<XToken[]>>;
sodax.backendApi.getMoneyMarketTokens(config?): Promise<Result<GetMoneyMarketTokensApiResponse>>;
sodax.backendApi.getMoneyMarketReserveAssets(...): Promise<Result<...>>;
sodax.backendApi.getMoneyMarketTokensByChainId(...): Promise<Result<XToken[]>>;
sodax.backendApi.getRelayChainIdMap(config?): Promise<Result<GetRelayChainIdMapApiResponse>>;
```

All methods return `Result<T, SodaxError<'EXTERNAL_API_ERROR'>>` where the error carries `feature: 'backend'`, `error.context.api === 'backend'`, and `context.endpoint`.

Every data / token / money-market response is validated at runtime against a valibot schema (like `sodax.api.swaps`): a 2xx body that fails the contract resolves to `EXTERNAL_API_ERROR` with `context.reason: 'invalid_response_shape'` rather than a mistyped value. The config/relay reads — `getAllConfig`, `getSpokeChainConfig`, `getRelayChainIdMap` — are **not** schema-validated (the `SodaxConfig` shape is too large to mirror faithfully, and `ConfigService` already version-gates and falls back to packaged defaults, so it relies on no response-shape guarantee).

## Common call shape — submit swap tx (`sodax.api.swaps.submitTx`)

After `sodax.swaps.createIntent({ params, raw: false, walletProvider })` returns:

```ts
const submitResult = await sodax.api.swaps.submitTx({
  txHash: spokeTxHash as string,
  srcChainKey: src.chain,
  walletAddress: '0x…',
  intent,                          // IntentRequestV2 (bigint fields) — the createIntent intent passes through
  relayData: relayData.payload,    // string, not the RelayExtraData object
});

if (!submitResult.ok) return;
```

## Swap-intent request DTO — `bound.accessToken` (Bitcoin TRADING)

`/swaps/approve` answers `ApproveResponseV2 = { tx, resetTx? }`. `resetTx` appears only when the
source token rejects a non-zero to non-zero allowance change (Ethereum USDT is the only listed one
today) **and** the wallet already holds a stale allowance — broadcast it first, wait for it to be
mined, then broadcast `tx`. Absent for every other token, so a client that ignores it keeps working.

`CreateIntentParamsV2` is the shared wire-level request body behind the typed `/swaps/allowance/check`, `/swaps/approve`, and `/swaps/intents` calls (the `IBackendApiV2` methods the SDK drives internally). It inherits the swap extras — `partnerFee`, `srcPublicKey`, and `bound` — from `SwapExtrasV2`, the JSON-safe mirror of the SDK `SwapExtras` (`QuoteRequestV2` inherits the same trio for its `includeTxData=true` path). `partnerFee` has no default on this path — see [`swaps-api.md`](swaps-api.md) § `partnerFee`. For Bitcoin **TRADING**-mode `raw` intents the Bound Exchange (Radfi) token is carried as `bound.accessToken` — passed in the request body instead of an `x-bound-access-token` header so it stays inside the typed DTO. Required only when the source chain is Bitcoin in TRADING mode; ignored otherwise.

You rarely build this DTO yourself: `sodax.swaps.createIntent` takes the token via the chain-key-gated `extras.bound.accessToken` slot and maps it onto `CreateIntentParamsV2.bound.accessToken`. See [`swap.md`](swap.md) § `SwapExtras` and [`../chain-specifics.md`](../chain-specifics.md) § "Bitcoin PSBT and Bound Exchange" for the consumer-facing flow and token-injection points.

## Custom backend (sandbox / fixtures)

`SodaxConfig` does not expose a typed slot to inject a custom `IConfigApiV1` implementation at construction. Two supported patterns:

1. **Point at a local mock backend** via `SodaxConfig.api.baseURL`:

   ```ts
   const sodax = new Sodax({
     api: { baseURL: 'http://localhost:4000' },
   });
   await sodax.config.initialize();
   ```

   `SodaxConfig.api` is `ApiConfig` — either the flat `BaseApiConfig` (`{ baseURL, timeout, headers }`, shared by the base API and the swaps client) or the nested `CustomApiConfig` (`{ baseApiConfig?, swapsApiConfig? }`) to point the swaps API at its own endpoint. Pass any subset via `DeepPartial`. See [`./swaps-api.md`](swaps-api.md) § "Custom endpoint for the swaps API".

2. **Inject your own `BackendApiService`-compatible mock at the app layer** (dependency-injected where you control the `Sodax` instance), rather than via the constructor.

The `IConfigApiV1` interface itself still matters for both patterns — every method returns `Promise<Result<T>>` in v2, so any mock or local server must conform. See [`../architecture.md`](../architecture.md) § 4 "Custom backend" for the authoritative reference.

## Cross-references

- v1 → v2 migration of `BackendApiService` (the load-bearing change: every method now returns `Promise<Result<T>>`): [`features/backend-api.md`](../../../migration-v1-to-v2/knowledge/features/backend-api.md).
- The full submit-tx flow with `createIntent` upstream: [`./swap.md`](swap.md) § "Backend submit-tx flow".
- The full typed Swaps API v2 client (`sodax.api.swaps`, 21 endpoints — quote, create-intent, submit-tx, fees, status, …): [`./swaps-api.md`](swaps-api.md).
- Partner-fee handling (separate service): [`./partner.md`](partner.md).
- Stuck-asset recovery (separate service): [`./recovery.md`](recovery.md).
- Error model context fields (`error.context.api`, `error.context.method`): [`../reference/`](../reference/) § 3.
