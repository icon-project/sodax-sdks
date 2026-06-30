# Backend API migration — v1 → v2

Pure-SDK migration playbook for `BackendApiService`. The load-bearing v1 → v2 change here is **`Result`-wrapping every method**.

Pair: [`features/backend-api.md`](../../../integration/knowledge/features/backend-api.md).

## TL;DR

1. **Every method now returns `Promise<Result<T>>`** (v1 returned plain `Promise<T>` and threw on failure). `IConfigApi` implementations must update method signatures.
2. **`SubmitSwapTxRequest.srcChainId` → `srcChainKey`.** And `relayData` field is `string` (`relayData.payload`), not the `RelayExtraData` object. (Cross-cutting detail; covered in detail in [`swap.md`](swap.md).)

## Type / symbol cheat sheet

| Method | v1 return | v2 return |
|---|---|---|
| `submitSwapTx` | `Promise<SubmitSwapTxResponse>` | `Promise<Result<SubmitSwapTxResponse>>` |
| `getIntentByHash` | `Promise<IntentResponse>` | `Promise<Result<IntentResponse>>` |
| `getIntentByTxHash` | (n/a in v1) | `Promise<Result<IntentResponse>>` (v2-new) |
| `getOrderbook` (was `getSolverOrderbook`) | `Promise<OrderbookResponse>` | `Promise<Result<OrderbookResponse>>` (object `{ total, data: Array<{ intentState, intentData }> }`, not an array) |
| `getUserIntents` (was `getUserSwapHistory`) | `Promise<UserIntentsResponse>` | `Promise<Result<UserIntentsResponse>>` (`{ total, offset, limit, items: IntentResponse[] }` — intents under `.items`) |
| `getChains` | `Promise<ChainConfig[]>` | `Promise<Result<GetChainsApiResponse>>` |
| `getSwapTokens` | `Promise<SwapTokenConfig>` | `Promise<Result<GetSwapTokensApiResponse>>` |
| `getSwapTokensByChainId` | `Promise<XToken[]>` | `Promise<Result<XToken[]>>` |
| `getMoneyMarketTokens` | `Promise<MMTokenConfig>` | `Promise<Result<GetMoneyMarketTokensApiResponse>>` |
| `getMoneyMarketTokensByChainId` | `Promise<XToken[]>` | `Promise<Result<XToken[]>>` |
| `SubmitSwapTxRequest.srcChainId` | numeric chain id | renamed → `srcChainKey: string` |
| `SubmitSwapTxRequest.relayData` | `RelayExtraData` object | now `string` (use `relayData.payload`) |

## Per-method delta

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
+   // result.error is a plain Error (e.g. HTTP_REQUEST_FAILED / REQUEST_TIMEOUT).
+   // NOT a SodaxError — no feature tag, no error.context.api, error.code is undefined.
+   return;
+ }
+ const response = result.value;
```

## Custom `IConfigApi` (sandbox / test fixtures)

If you implemented `IConfigApi` for a sandbox or test fixture, two things changed in v2:

**1. Method signatures.** Every method now returns `Promise<Result<T>>` instead of throwing on failure:

```diff
  const sandboxApi: IConfigApi = {
-   async getChains(): Promise<ChainConfig[]> {
-     return [/* fixture */];
-   },
-   async getSwapTokens(): Promise<SwapTokenConfig> { /* … */ },
+   async getChains(): Promise<Result<readonly SpokeChainKey[]>> {
+     return { ok: true, value: [/* fixture: chain KEYS, not configs */] };
+   },
+   async getSwapTokens(): Promise<Result<Record<SpokeChainKey, readonly XToken[]>>> { /* … */ },
    // …5 methods total
  };
```

**2. Injection mechanism.** `SodaxConfig` does NOT expose a typed slot to inject a custom `IConfigApi` at construction. v1 patterns that passed a custom api into `new Sodax(...)` no longer typecheck. Point at a local mock via `SodaxConfig.api.baseURL`, or inject your own `BackendApiService`-compatible mock at the app layer. See [`../../../integration/knowledge/architecture.md`](../../../integration/knowledge/architecture.md) § 4 "Custom backend" for the v2 pattern.

## Pitfalls

1. **`SubmitSwapTxRequest.relayData` is `string`, not the `RelayExtraData` object.** v1 took the object; v2 takes the `payload` field as a string.
2. **Direct backendApi failures return a plain `Error`, not a `SodaxError`.** `BackendApiService.request()` returns `{ ok: false, error: Error }` (`HTTP_REQUEST_FAILED` / `REQUEST_TIMEOUT` / `UNKNOWN_REQUEST_ERROR`, or an `Invalid …response shape` error). There is no `feature`, no `error.context.api`, and `error.code` is `undefined` — don't branch on them.
3. **Custom `IConfigApi` implementations must return `Result<T>`** — old throw-on-error implementations will compile-error against the v2 interface.

## Verification

```bash
pnpm -C <your-app-dir> checkTs

# Targeted scans:
grep -rE "srcChainId:\s*\w+|\.relayData(?!\s*\.payload)" src/   # legacy field name + non-string relayData
```

## Cross-references

- v2 backend API usage: [`features/backend-api.md`](../../../integration/knowledge/features/backend-api.md).
- `submitSwapTx` flow with `createIntent` upstream: [`./swap.md`](swap.md) (the swap migration covers the request-shape changes in detail).
- Partner migration (separate service): [`./partner.md`](partner.md).
- Recovery migration (separate service, new in v2): [`./recovery.md`](recovery.md).
- Result/error model: [`../breaking-changes/result-and-errors.md`](../breaking-changes/result-and-errors.md).
- `IConfigApi` Result-wrapping cross-cutting note: [`../breaking-changes/type-system.md`](../breaking-changes/type-system.md) § 6.
