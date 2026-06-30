# Backend API — `BackendApiService`

HTTP client for backend services. Provides intent lookup, swap-tx submission, solver orderbook queries, money-market position/reserve reads, and (internally) config fetching. Most consumer-side code uses just `submitSwapTx`, `getIntentByHash` / `getIntentByTxHash`, and the money-market read methods.

Access: `sodax.backendApi`. Service class: `BackendApiService`. **Error shape:** direct `sodax.backendApi.<method>()` failures return `{ ok: false, error }` where `error` is a plain `Error` (`HTTP_REQUEST_FAILED` / `REQUEST_TIMEOUT` / `UNKNOWN_REQUEST_ERROR`, or an `Invalid …response shape` error). It is **not** a `SodaxError`: no `feature` tag, no `error.context.api`, and `error.code` is `undefined`.

## Methods

```ts
// Swap-related
sodax.backendApi.submitSwapTx(request, config?): Promise<Result<SubmitSwapTxResponse>>;
sodax.backendApi.getSubmitSwapTxStatus(...): Promise<Result<...>>;
sodax.backendApi.getOrderbook(...): Promise<Result<OrderbookResponse>>; // object: { total: number; data: Array<{ intentState, intentData }> } — NOT an array
sodax.backendApi.getIntentByHash(intentHash, config?): Promise<Result<IntentResponse>>;
sodax.backendApi.getIntentByTxHash(txHash, config?): Promise<Result<IntentResponse>>;
sodax.backendApi.getUserIntents(...): Promise<Result<UserIntentsResponse>>; // { total, offset, limit, items: IntentResponse[] } — intents under .items

// Money-market reads (these are the canonical reads for MM positions/reserves;
// MoneyMarketService does NOT expose getReservesData / getUserReservesData / etc.)
sodax.backendApi.getMoneyMarketPosition(...): Promise<Result<...>>;
sodax.backendApi.getAllMoneyMarketAssets(config?): Promise<Result<MoneyMarketAsset[]>>;
sodax.backendApi.getMoneyMarketAsset(reserveAddress, config?): Promise<Result<MoneyMarketAsset>>;
sodax.backendApi.getMoneyMarketAssetBorrowers(...): Promise<Result<...>>;
sodax.backendApi.getMoneyMarketAssetSuppliers(...): Promise<Result<...>>;
sodax.backendApi.getAllMoneyMarketBorrowers(...): Promise<Result<...>>;

// Config-API methods (used internally by ConfigService — implements `IConfigApi`)
sodax.backendApi.getAllConfig(config?): Promise<Result<GetAllConfigApiResponse>>;
sodax.backendApi.getChains(config?): Promise<Result<GetChainsApiResponse>>;
sodax.backendApi.getSwapTokens(config?): Promise<Result<GetSwapTokensApiResponse>>;
sodax.backendApi.getSwapTokensByChainId(...): Promise<Result<XToken[]>>;
sodax.backendApi.getMoneyMarketTokens(config?): Promise<Result<GetMoneyMarketTokensApiResponse>>;
sodax.backendApi.getMoneyMarketReserveAssets(...): Promise<Result<...>>;
sodax.backendApi.getMoneyMarketTokensByChainId(...): Promise<Result<XToken[]>>;
sodax.backendApi.getRelayChainIdMap(config?): Promise<Result<GetRelayChainIdMapApiResponse>>;
```

All methods return `Promise<Result<T>>`. On failure the `error` field is a plain `Error` — `BackendApiService` never constructs a `SodaxError`, so there is no `feature` tag, no `error.context.api`, and `error.code` is `undefined`.

## Common call shape — `submitSwapTx`

After `sodax.swaps.createIntent({ params, raw: false, walletProvider })` returns:

```ts
const submitResult = await sodax.backendApi.submitSwapTx({
  txHash: spokeTxHash as string,
  srcChainKey: src.chain,
  walletAddress: '0x…',
  intent: swapIntentData,
  relayData: relayData.payload,    // string, not the RelayExtraData object
});

if (!submitResult.ok) return;
```

## Swap-intent request DTO — `bound.accessToken` (Bitcoin TRADING)

`CreateIntentParamsV2` is the shared wire-level request body behind the typed `/swaps/allowance/check`, `/swaps/approve`, and `/swaps/intents` calls (the `IBackendApiV2` methods the SDK drives internally). It inherits the swap extras — `partnerFee`, `srcPublicKey`, and `bound` — from `SwapExtrasV2`, the JSON-safe mirror of the SDK `SwapExtras` (`QuoteRequestV2` inherits the same trio for its `includeTxData=true` path). For Bitcoin **TRADING**-mode `raw` intents the Bound Exchange (Radfi) token is carried as `bound.accessToken` — passed in the request body instead of an `x-bound-access-token` header so it stays inside the typed DTO. Required only when the source chain is Bitcoin in TRADING mode; ignored otherwise.

You rarely build this DTO yourself: `sodax.swaps.createIntent` takes the token via the chain-key-gated `extras.bound.accessToken` slot and maps it onto `CreateIntentParamsV2.bound.accessToken`. See [`swap.md`](swap.md) § `SwapExtras` and [`../chain-specifics.md`](../chain-specifics.md) § "Bitcoin PSBT and Bound Exchange" for the consumer-facing flow and token-injection points.

## Custom backend (sandbox / fixtures)

`SodaxConfig` does not expose a typed slot to inject a custom `IConfigApi` implementation at construction. Two supported patterns:

1. **Point at a local mock backend** via `SodaxConfig.api.baseURL`:

   ```ts
   const sodax = new Sodax({
     api: { baseURL: 'http://localhost:4000' },
   });
   await sodax.config.initialize();
   ```

   `SodaxConfig.api` is `ApiConfig` (`{ baseURL, timeout, headers }`) — pass any subset via `DeepPartial`.

2. **Inject your own `BackendApiService`-compatible mock at the app layer** (dependency-injected where you control the `Sodax` instance), rather than via the constructor.

The `IConfigApi` interface itself still matters for both patterns — every method returns `Promise<Result<T>>` in v2, so any mock or local server must conform. See [`../architecture.md`](../architecture.md) § 4 "Custom backend" for the authoritative reference.

## Cross-references

- v1 → v2 migration of `BackendApiService` (the load-bearing change: every method now returns `Promise<Result<T>>`): [`features/backend-api.md`](../../../migration-v1-to-v2/knowledge/features/backend-api.md).
- The full `submitSwapTx` flow with `createIntent` upstream: [`./swap.md`](swap.md) § "Backend submit-tx flow".
- Partner-fee handling (separate service): [`./partner.md`](partner.md).
- Stuck-asset recovery (separate service): [`./recovery.md`](recovery.md).
- Error model context fields (`error.context.api`, `error.context.method`): [`../reference/`](../reference/) § 3.
