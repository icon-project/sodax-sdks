# Swaps API — `SwapsApiService`

Typed HTTP client for the backend **Swaps API v2** (`/swaps/*`). Reachable as `sodax.api.swaps`
(`sodax.api` is an alias for `sodax.backendApi`; `.swaps` is the `SwapsApiService` instance). One method
per endpoint (21 total). Every method returns `Promise<Result<T>>` — it **never throws** — and every
response is validated at runtime against a valibot schema, so a backend contract drift surfaces as
`{ ok: false }` rather than an untyped object.

Access: `sodax.api.swaps`. Service class: `SwapsApiService`. **Errors:** every failure (network, timeout,
non-2xx HTTP, or response-shape mismatch) returns `Result<T, SodaxError<'EXTERNAL_API_ERROR'>>` with
`feature: 'backend'`, `context.api: 'swaps'`, and `context.endpoint` (the path). The underlying failure
is preserved on `error.cause` — a `SwapsApiError` from the `@sodax/swaps-api` client this service wraps
(read its `code`: `NETWORK_ERROR` | `TIMEOUT_ERROR` | `HTTP_ERROR` | `PARSE_ERROR` | `VALIDATION_ERROR`;
the same code is mirrored on `error.context.code`, and both `SwapsApiError` and the `SwapsApiErrorCode`
union are re-exported from `@sodax/sdk`). Idempotent
reads/polls (and pure-compute POSTs like `getQuote`) retry transient failures; mutating calls do not.
This differs from the feature services (`sodax.swaps`, etc.), whose errors carry their own `feature`
(`'swap'`, …) — the swaps **HTTP client** is uniformly `feature: 'backend'`.

## Methods

```ts
// Tokens
sodax.api.swaps.getTokens(config?): Promise<Result<GetSwapTokensResponseV2>>;
sodax.api.swaps.getTokensByChain(chainKey, config?): Promise<Result<GetSwapTokensByChainResponseV2>>;

// Quote · deadline
sodax.api.swaps.getQuote(body: QuoteRequestV2, query?: QuoteQueryV2, config?): Promise<Result<QuoteResponseV2>>;
sodax.api.swaps.getDeadline(query?: DeadlineQueryV2, config?): Promise<Result<DeadlineResponseV2>>;

// Allowance · approve · create intent — all three share the CreateIntentParamsV2 body
sodax.api.swaps.checkAllowance(body: CreateIntentParamsV2, config?): Promise<Result<AllowanceCheckResponseV2>>;
sodax.api.swaps.approve(body: CreateIntentParamsV2, config?): Promise<Result<ApproveResponseV2>>;
sodax.api.swaps.createIntent(body: CreateIntentParamsV2, config?): Promise<Result<CreateIntentResponseV2>>;

// Intent lifecycle: submit · status · cancel · hash · packet · extra-data · fill · get
sodax.api.swaps.submitIntent(body: SubmitIntentRequestV2, config?): Promise<Result<SubmitIntentResponseV2>>;
sodax.api.swaps.getStatus(body: StatusRequestV2, config?): Promise<Result<StatusResponseV2>>;
sodax.api.swaps.cancelIntent(body: CancelIntentRequestV2, config?): Promise<Result<CancelIntentResponseV2>>;
sodax.api.swaps.getIntentHash(body: IntentHashRequestV2, config?): Promise<Result<IntentHashResponseV2>>;
sodax.api.swaps.getSolvedIntentPacket(body: IntentPacketRequestV2, config?): Promise<Result<IntentPacketResponseV2>>;
sodax.api.swaps.getIntentSubmitTxExtraData(body: IntentExtraDataRequestV2, config?): Promise<Result<IntentExtraDataResponseV2>>;
sodax.api.swaps.getFilledIntent(txHash, config?): Promise<Result<IntentStateV2>>;
sodax.api.swaps.getIntent(txHash, config?): Promise<Result<GetIntentResponseV2>>;

// Limit orders · gas · fees
sodax.api.swaps.createLimitOrderIntent(body: CreateLimitOrderParamsV2, config?): Promise<Result<CreateLimitOrderResponseV2>>;
sodax.api.swaps.estimateGas(body: GasEstimateRequestV2, config?): Promise<Result<GasEstimateResponseV2>>;
sodax.api.swaps.getPartnerFee(query: FeeQueryV2, config?): Promise<Result<FeeResponseV2>>;
sodax.api.swaps.getSolverFee(query: FeeQueryV2, config?): Promise<Result<FeeResponseV2>>;

// Submit-tx state machine
sodax.api.swaps.submitTx(body: SubmitTxRequestV2, config?): Promise<Result<SubmitTxResponseV2>>;
sodax.api.swaps.getSubmitTxStatus(query: SubmitTxStatusQueryV2, config?): Promise<Result<SubmitTxStatusResponseV2>>;
```

The optional trailing `config?: RequestOverrideConfig` (`{ baseURL?, timeout?, headers? }`) on every method
applies per-call overrides that take precedence over the service config (see "Per-call overrides" below).

## Wire shapes — `bigint` vs decimal strings

Request bodies that carry an `intent` struct (`cancelIntent`, `getIntentHash`,
`getIntentSubmitTxExtraData`, `submitTx`) take `IntentRequestV2`, whose numeric fields
(`intentId`, `inputAmount`, `minOutputAmount`, `deadline`, `srcChain`, `dstChain`) are **`bigint`**; the
client serializes them to decimal strings on the wire. Server-returned intents (`IntentResponseV2`) come
back with those fields as decimal **`string`** (outbound JSON can't carry bigint). The `amount` /
`inputAmount` fields on the quote / create-intent request bodies are already decimal **strings**.

## Common call shapes

### Quote

```ts
const quote = await sodax.api.swaps.getQuote({
  tokenSrc, tokenSrcChainKey, tokenDst, tokenDstChainKey,
  amount: '1000000',          // smallest unit, decimal string
  quoteType: 'exact_input',
});
if (!quote.ok) return;
quote.value.quotedAmount;     // decimal string
// Pass query `{ includeTxData: true }` (and srcAddress/dstAddress on the body) to also get `txData`.
```

### Create intent

```ts
const created = await sodax.api.swaps.createIntent({
  srcChainKey, dstChainKey, inputToken, outputToken,
  inputAmount: '1000000',
  minOutputAmount: '990000',
  deadline: '0',              // "0" → no expiry (limit-order semantics)
  allowPartialFill: false,
  srcAddress, dstAddress,
});
if (!created.ok) return;
const { tx, intent, relayData } = created.value;
```

### Submit tx + poll status

```ts
// `intent` here is the IntentRequestV2 (bigint fields) you hold from createIntent.
const submit = await sodax.api.swaps.submitTx({
  txHash, srcChainKey, walletAddress, intent,
  relayData: relayData.payload,   // string — the payload, not the RelayExtraData object
});
if (!submit.ok) return;

// Both txHash AND srcChainKey are required by the status endpoint.
const status = await sodax.api.swaps.getSubmitTxStatus({ txHash, srcChainKey });
if (status.ok && status.value.data.status === 'solved') { /* settled */ }
// Lifecycle: 'pending' → 'relaying' → 'relayed' → 'posting_execution' → 'posted_execution' → 'solved' | 'failed'.
```

## Status fields — three distinct `status` values (don't conflate)

| Call | Field | Type | Values |
|---|---|---|---|
| `getStatus` | `StatusResponseV2.status` | **number** (`SwapIntentStatusCodeV2`) | `-1` NOT_FOUND · `1` NOT_STARTED_YET · `2` STARTED_NOT_FINISHED · `3` SOLVED (terminal) · `4` FAILED (terminal). `fillTxHash` is set only when `status === 3`. |
| `submitTx` | `SubmitTxResponseV2.data.status` | string | `'inserted'` (new) or `'duplicate'` (already submitted — submit-tx is idempotent on `(txHash, srcChainKey)`). |
| `getSubmitTxStatus` | `SubmitTxStatusResponseV2.data.status` | string | `'pending'` / `'relaying'` / `'relayed'` / `'posting_execution'` / `'posted_execution'` / `'solved'` / `'failed'` (`'solved'` / `'failed'` terminal). |

`getStatus` reports the **solver** intent status as a numeric code (`3` = `SOLVED`); the two submit-tx calls report **string** statuses (submission result vs relay-processing lifecycle, whose success terminal is the string `'solved'`). They are unrelated — don't treat one as the other; note the numeric solver `SOLVED` (`3`) is distinct from the submit-tx string `'solved'`.

## Per-call overrides

Every method accepts a trailing `RequestOverrideConfig` to redirect a single call to a different host or
attach request-specific headers (auth, tracing), overriding the service config:

```ts
await sodax.api.swaps.getTokens({ baseURL: 'https://staging.example/v1/be', headers: { 'X-Trace': 'abc' } });
```

## Custom endpoint for the swaps API

By default the swaps endpoints are `/swaps/*` sub-paths under the same base URL as `sodax.backendApi`.
To point the swaps API at its own host (separate from the base backend API), construct `Sodax` with the
**`CustomApiConfig`** variant of `ApiConfig` (`{ baseApiConfig?, swapsApiConfig? }`) instead of the flat
`BaseApiConfig`:

```ts
const sodax = new Sodax({
  api: {
    baseApiConfig: { baseURL: 'https://api.example/v1/be' },
    swapsApiConfig: { baseURL: 'https://swaps.example/v1' },
  },
});
```

The swaps slice layers over the base slice over the defaults (per field), so a cross-cutting header on
`baseApiConfig` (auth/tracing) still reaches swaps calls unless `swapsApiConfig` overrides that key. A flat
`BaseApiConfig` (the common case) is shared by both clients. See
[`backend-api.md`](backend-api.md) § "Custom backend" and [`../architecture.md`](../architecture.md).

## Error handling

```ts
const r = await sodax.api.swaps.getQuote(body);
if (!r.ok) {
  // r.error: SodaxError<'EXTERNAL_API_ERROR'> — feature: 'backend', context.api: 'swaps',
  // context.endpoint: '/swaps/quote'. The transport failure (HTTP_REQUEST_FAILED / REQUEST_TIMEOUT /
  // a shape-validation issue) is on r.error.cause.
  return;
}
```

## Cross-references

- `sodax.swaps` (the `SwapService` orchestrator that creates/executes intents end-to-end): [`swap.md`](swap.md). The swaps **API client** here is the lower-level HTTP surface; the orchestrator is the higher-level flow.
- `BackendApiService` (the sibling client for intent/orderbook/money-market reads): [`backend-api.md`](backend-api.md).
- Error model context fields: [`../reference/error-codes.md`](../reference/error-codes.md).
