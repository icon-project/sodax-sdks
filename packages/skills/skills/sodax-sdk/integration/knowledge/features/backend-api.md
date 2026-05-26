# Backend API — `BackendApiService`

HTTP client for backend services. Provides intent lookup, swap-tx submission, solver orderbook queries, money-market position/reserve reads, and (internally) config fetching. Most consumer-side code uses just `submitSwapTx`, `getIntentByHash` / `getIntentByTxHash`, and the money-market read methods.

Access: `sodax.backendApi`. Service class: `BackendApiService`. **Feature tag for errors:** appears under multiple features depending on the call site (`'swap'` for `submitSwapTx`, `'moneyMarket'` for MM-related reads, etc.); errors carry `error.context.api: 'backend'`.

## Methods

```ts
// Swap-related
sodax.backendApi.submitSwapTx(request, config?): Promise<Result<SubmitSwapTxResponse>>;
sodax.backendApi.getSubmitSwapTxStatus(...): Promise<Result<...>>;
sodax.backendApi.getOrderbook(...): Promise<Result<OrderbookEntry[]>>;
sodax.backendApi.getIntentByHash(intentHash, config?): Promise<Result<IntentResponse>>;
sodax.backendApi.getIntentByTxHash(txHash, config?): Promise<Result<IntentResponse>>;
sodax.backendApi.getUserIntents(...): Promise<Result<IntentResponse[]>>;

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

All methods return `Result<T, SodaxError>` where the error carries `feature: 'swap' | 'moneyMarket' | …` (depending on call site) and `error.context.api === 'backend'`.

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

## Custom backend (sandbox / fixtures)

Inject an `IConfigApi` implementation via `SodaxConfig.backendApi.api`:

```ts
const sandboxApi: IConfigApi = {
  async getChains() { return { ok: true, value: [/* fixture */] }; },
  // …
};

const sodax = new Sodax({
  backendApi: { url: 'unused', api: sandboxApi },
});
await sodax.config.initialize();
```

Every method on `IConfigApi` returns `Promise<Result<T>>` in v2.

## Cross-references

- v1 → v2 migration of `BackendApiService` (the load-bearing change: every method now returns `Promise<Result<T>>`): [`features/backend-api.md`](../../../migration-v1-to-v2/knowledge/features/backend-api.md).
- The full `submitSwapTx` flow with `createIntent` upstream: [`./swap.md`](swap.md) § "Backend submit-tx flow".
- Partner-fee handling (separate service): [`./partner.md`](partner.md).
- Stuck-asset recovery (separate service): [`./recovery.md`](recovery.md).
- Error model context fields (`error.context.api`, `error.context.method`): [`../reference/`](../reference/) § 3.
