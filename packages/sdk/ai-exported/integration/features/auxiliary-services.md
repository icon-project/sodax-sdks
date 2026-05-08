# Auxiliary services — `PartnerService`, `RecoveryService`, `BackendApiService`

Three small services grouped together. None has the surface area of the major features (swap, money market, etc.), but they're load-bearing in real consumer flows.

## `PartnerService` — `sodax.partners`

Partner-fee handling. `PartnerService` itself only exposes `feeClaim: PartnerFeeClaimService` and `config: ConfigService` as public fields. Every operation lives on `sodax.partners.feeClaim`.

**Feature tag for errors:** `'partner'`.

### Methods (all on `sodax.partners.feeClaim`)

```ts
// Token approval
sodax.partners.feeClaim.isTokenApproved({ token, srcAddress }): Promise<Result<boolean, Error>>;
sodax.partners.feeClaim.approveToken<Raw>(args): Promise<Result<TxReturnType, Error>>;

// Auto-swap preferences (whether partner-collected fees auto-swap into a target asset)
sodax.partners.feeClaim.getAutoSwapPreferences(queryAddress): Promise<Result<AutoSwapPreferences, Error>>;
sodax.partners.feeClaim.setSwapPreference<K, Raw>(args): Promise<Result<TxReturnType, Error>>;

// Fee claim flows
sodax.partners.feeClaim.swap(args): Promise<Result<...>>;                           // immediate fee swap
sodax.partners.feeClaim.createIntentAutoSwap<Raw>(args): Promise<Result<...>>;       // intent-driven auto-swap

// Reads
sodax.partners.feeClaim.fetchAssetsBalances(args): Promise<Result<...>>;
sodax.partners.feeClaim.getOriginalAssetAddress(chainId, hubAsset): OriginalAssetAddress | undefined;
sodax.partners.feeClaim.getSpokeTokenFromOriginalAssetAddress(...): /* … */;
```

### Common call shape

```ts
// 1. Check whether the partner's fee token is approved on the hub:
const approved = await sodax.partners.feeClaim.isTokenApproved({
  token: '0x…',         // hub asset address
  srcAddress: partnerAddress,
});

// 2. Approve once if not:
if (approved.ok && !approved.value) {
  await sodax.partners.feeClaim.approveToken({
    params: { token: '0x…', amount: 2n ** 256n - 1n },
    raw: false,
    walletProvider: sonicWp,
  });
}

// 3. Configure auto-swap preference (one-time):
await sodax.partners.feeClaim.setSwapPreference({
  params: { /* preference fields */ },
  raw: false,
  walletProvider: sonicWp,
});
```

### Error codes

`feature: 'partner'`. Action methods get the full exec set; reads get `LookupErrorCode` partitioned by `error.context.method`.

---

## `RecoveryService` — `sodax.recovery`

Withdraw stuck assets from a user's hub wallet abstraction back to a spoke chain. Useful when a cross-chain operation deposited to the hub but the destination step failed (e.g. relay timeout after the spoke tx landed).

**Feature tag for errors:** `'recovery'`.

### Methods

```ts
// Read: list balances of all known hub assets in a user's hub wallet abstraction.
sodax.recovery.fetchHubAssetBalances(args): Promise<Result<HubAssetBalance[], SodaxError>>;

// Mutation: withdraw a single hub asset back to a spoke chain.
// Returns a tx-pair when raw: false (the hub-side spend + the relayed spoke-side receive).
sodax.recovery.withdrawHubAsset<K extends SpokeChainKey, Raw extends boolean>(
  action: WithdrawHubAssetAction<K, Raw>,
): Promise<Result<TxReturnType<K, Raw>, SodaxError>>;
```

### Common call shape

```ts
// 1. Find what's stuck on the hub for this user:
const balances = await sodax.recovery.fetchHubAssetBalances({ /* user / hub-wallet args */ });
if (!balances.ok || balances.value.length === 0) return;

// 2. Withdraw one entry back to a spoke chain:
const result = await sodax.recovery.withdrawHubAsset({
  params: {
    /* hub-asset address, amount, destination spoke chain key, destination address */
  },
  raw: false,
  walletProvider: sonicWp,
});
```

### Error codes

`feature: 'recovery'`. The mutation method returns the full exec set (including relay codes); the read method returns `LookupErrorCode` partitioned by `error.context.method`.

### When to use

Recovery is a workaround for failed cross-chain operations. Best used **after** investigating why the original operation failed — relay timeouts may resolve on retry; structural failures need fixing first.

---

## `BackendApiService` — `sodax.backendApi`

HTTP client for backend services. Provides intent lookup, swap-tx submission, solver orderbook queries, and (internally) config fetching. Most consumer-side code uses just `submitSwapTx` and `getIntentByHash`.

**Feature tag for errors:** appears under multiple features depending on the call site (`'swap'` for `submitSwapTx`); errors carry `error.context.api: 'backend'`.

### Methods

```ts
sodax.backendApi.submitSwapTx(request: SubmitSwapTxRequest): Promise<Result<SubmitSwapTxResponse, SodaxError>>;
sodax.backendApi.getIntentByHash(txHash, chainKey): Promise<Result<IntentResponse, SodaxError>>;
sodax.backendApi.getSolverOrderbook(): Promise<Result<OrderbookEntry[], SodaxError>>;
sodax.backendApi.getUserSwapHistory(walletAddress, chainKey): Promise<Result<SwapHistoryEntry[], SodaxError>>;
// + config-API methods (used internally by ConfigService):
sodax.backendApi.getChains(): Promise<Result<ChainConfig[], SodaxError>>;
sodax.backendApi.getSwapTokens(): Promise<Result<SwapTokenConfig, SodaxError>>;
// …
```

All methods return `Result<T, SodaxError>` where the error carries `feature: 'swap' | …` (depending on call site) and `error.context.api === 'backend'`.

### Common call shape — `submitSwapTx`

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

### Custom backend (sandbox / fixtures)

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

---

## Cross-references

- v1 → v2 migration of these auxiliary services: [`../../migration/features/auxiliary-services.md`](../../migration/features/auxiliary-services.md).
- The full `submitSwapTx` flow with `createIntent` upstream: [`./swap.md`](swap.md) § "Backend submit-tx flow".
- Error model context fields (`error.context.api`, `error.context.method`): [`../reference.md`](../reference.md) § 3.
