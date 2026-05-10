# Auxiliary services migration — v1 → v2

Pure-SDK migration playbook for `PartnerService`, `RecoveryService`, and `BackendApiService`. Three small services grouped because each has a small surface area.

Pair: [`../../integration/features/auxiliary-services.md`](../../integration/features/auxiliary-services.md).

## TL;DR

1. **`PartnerService`:** standard pattern. Drop `spokeProvider`; pass `walletProvider`. Add `srcChainKey` + `srcAddress` to claim params. v1's 5 typed errors collapse into `SodaxError<C>` with `feature: 'partner'`.
2. **`RecoveryService`:** **new in v2.** No v1 equivalent — there's no migration to do for code that didn't exist before. Just integration: see [`../../integration/features/auxiliary-services.md`](../../integration/features/auxiliary-services.md).
3. **`BackendApiService`:** the load-bearing change. **Every method now returns `Promise<Result<T>>`** (v1 returned plain `Promise<T>` and threw on failure). `IConfigApi` implementations must update method signatures.
4. **`SubmitSwapTxRequest.srcChainId` → `srcChainKey`.** And `relayData` field is `string` (`relayData.payload`), not the `RelayExtraData` object. (Cross-cutting detail; covered in detail in [`swap.md`](swap.md).)

## `PartnerService`

### Type / symbol cheat sheet

| Type | v1 shape | v2 shape | Notes |
|---|---|---|---|
| Partner action params | non-generic | now generic `<K>` with `srcChainKey`, `srcAddress` | |
| Partner errors (5 types) | `PartnerFeeClaimError<...>` and 4 siblings | `SodaxError<C>` with `feature: 'partner'` | All 5 v1 typed errors collapse. |

### v1 → v2 error code crosswalk

All 5 v1 partner error codes map to `EXECUTION_FAILED` with `error.context.action` discriminating between the operations.

### Per-method delta

Partner operations live on `sodax.partners.feeClaim` (a `PartnerFeeClaimService`), not directly on `sodax.partners`. v1 method names also changed:

```diff
- await sodax.partners.claimFees({ /* … */ }, spokeProvider);
+ // Approve once, then configure auto-swap preference, then run swaps.
+ // Full method list lives in integration/features/auxiliary-services.md.
+ const approved = await sodax.partners.feeClaim.isTokenApproved({ token, srcAddress });
+ if (approved.ok && !approved.value) {
+   await sodax.partners.feeClaim.approveToken({
+     params: { token, amount },
+     raw: false,
+     walletProvider,
+   });
+ }
```

### Pitfalls

1. **Partner methods moved.** They live on `sodax.partners.feeClaim`, not `sodax.partners` directly. The parent only exposes `feeClaim` and `config` as public fields.
2. **All 5 v1 partner errors collapse to `feature: 'partner'`.** Even though they share the `EXECUTION_FAILED` code with every other feature.

---

## `RecoveryService`

**No v1 equivalent.** v1 didn't have a public recovery service. Failed cross-chain operations had to be handled ad-hoc.

If you have v1 code that worked around this (e.g. manually walked the hub wallet abstraction to find stuck assets), replace it with `fetchHubAssetBalances` + `withdrawHubAsset`:

```ts
const balances = await sodax.recovery.fetchHubAssetBalances({ /* user / hub-wallet args */ });
if (balances.ok && balances.value.length > 0) {
  await sodax.recovery.withdrawHubAsset({
    params: { /* hub-asset address, amount, destination spoke chain + address */ },
    raw: false,
    walletProvider: sonicWp,
  });
}
```

See [`../../integration/features/auxiliary-services.md`](../../integration/features/auxiliary-services.md) § "RecoveryService".

---

## `BackendApiService`

The load-bearing v1 → v2 change here is **`Result`-wrapping every method**.

### Type / symbol cheat sheet

| Method | v1 return | v2 return |
|---|---|---|
| `submitSwapTx` | `Promise<SubmitSwapTxResponse>` | `Promise<Result<SubmitSwapTxResponse>>` |
| `getIntentByHash` | `Promise<IntentResponse>` | `Promise<Result<IntentResponse>>` |
| `getIntentByTxHash` | (n/a in v1) | `Promise<Result<IntentResponse>>` (v2-new) |
| `getOrderbook` (was `getSolverOrderbook`) | `Promise<OrderbookEntry[]>` | `Promise<Result<OrderbookEntry[]>>` |
| `getUserIntents` (was `getUserSwapHistory`) | `Promise<IntentResponse[]>` | `Promise<Result<IntentResponse[]>>` |
| `getChains` | `Promise<ChainConfig[]>` | `Promise<Result<GetChainsApiResponse>>` |
| `getSwapTokens` | `Promise<SwapTokenConfig>` | `Promise<Result<GetSwapTokensApiResponse>>` |
| `getSwapTokensByChainId` | `Promise<XToken[]>` | `Promise<Result<XToken[]>>` |
| `getMoneyMarketTokens` | `Promise<MMTokenConfig>` | `Promise<Result<GetMoneyMarketTokensApiResponse>>` |
| `getMoneyMarketTokensByChainId` | `Promise<XToken[]>` | `Promise<Result<XToken[]>>` |
| `SubmitSwapTxRequest.srcChainId` | numeric chain id | renamed → `srcChainKey: SpokeChainKey` |
| `SubmitSwapTxRequest.relayData` | `RelayExtraData` object | now `string` (use `relayData.payload`) |

### Per-method delta

```diff
- const response: SubmitSwapTxResponse = await sodax.backendApi.submitSwapTx(request);
- // throws on failure
+ const result = await sodax.backendApi.submitSwapTx({
+   txHash: spokeTxHash as string,
+   srcChainKey: src.chain,                  // was: srcChainId
+   walletAddress: '0x…',
+   intent: swapIntentData,
+   relayData: relayData.payload,            // was: relayData (object)
+ });
+ if (!result.ok) {
+   // result.error: SodaxError with feature: 'swap', context.api: 'backend'
+   return;
+ }
+ const response = result.value;
```

### Custom `IConfigApi` (sandbox / test fixtures)

If you implemented `IConfigApi` for a sandbox or test fixture:

```diff
  const sandboxApi: IConfigApi = {
-   async getChains(): Promise<ChainConfig[]> {
-     return [/* fixture */];
-   },
-   async getSwapTokens(): Promise<SwapTokenConfig> { /* … */ },
+   async getChains(): Promise<Result<ChainConfig[], unknown>> {
+     return { ok: true, value: [/* fixture */] };
+   },
+   async getSwapTokens(): Promise<Result<SwapTokenConfig, unknown>> { /* … */ },
    // …5 methods total
  };
```

Every method on the contract returns `Promise<Result<T>>` in v2.

### Pitfalls

1. **`SubmitSwapTxRequest.relayData` is `string`, not the `RelayExtraData` object.** v1 took the object; v2 takes the `payload` field as a string.
2. **Backend errors carry `error.context.api === 'backend'`** but the `feature` reflects the call site (`'swap'` for `submitSwapTx`, `'moneyMarket'` for MM-related backend calls, etc.). Use both for logger tag pairs.
3. **Custom `IConfigApi` implementations must return `Result<T>`** — old throw-on-error implementations will compile-error against the v2 interface.

---

## Verification

```bash
pnpm -C <your-app-dir> checkTs

# Targeted scans:
grep -rE "spokeProvider:\s*\w+|isPartnerError\b|PartnerFeeClaimError\b" src/
grep -rE "srcChainId:\s*\w+|\.relayData(?!\s*\.payload)" src/   # legacy field name + non-string relayData
```

## Cross-references

- v2 auxiliary services usage: [`../../integration/features/auxiliary-services.md`](../../integration/features/auxiliary-services.md).
- `submitSwapTx` flow with `createIntent` upstream: [`./swap.md`](swap.md) (the swap migration covers the request-shape changes in detail).
- Result/error model: [`../breaking-changes/result-and-errors.md`](../breaking-changes/result-and-errors.md).
- `IConfigApi` Result-wrapping cross-cutting note: [`../breaking-changes/type-system.md`](../breaking-changes/type-system.md) § 6.
