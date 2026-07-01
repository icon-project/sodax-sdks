# Bridge API — `BridgeApiService`

Typed HTTP client for the backend **Bridge API v2** (`/bridge/*`). Reachable as `sodax.api.bridge`
(`sodax.api` is an alias for `sodax.backendApi`; `.bridge` is the `BridgeApiService` instance). One method
per endpoint (7 total). Every method returns `Promise<Result<T>>` — it **never throws** — and every
response is validated at runtime against a valibot schema, so a backend contract drift surfaces as
`{ ok: false }` rather than an untyped object.

Access: `sodax.api.bridge`. Service class: `BridgeApiService`. **Errors:** every failure (network, timeout,
non-2xx HTTP, or response-shape mismatch) returns `Result<T, SodaxError<'EXTERNAL_API_ERROR'>>` with
`feature: 'backend'`, `context.api: 'bridge'`, and `context.endpoint` (the path); the underlying failure
is on `error.cause`. Like `sodax.api.swaps`, the bridge **HTTP client** is uniformly `feature: 'backend'`
(with a per-service `context.api` tag — `'bridge'`).

> Lower-level than `sodax.bridge` (the `BridgeService` orchestrator that deposits + relays end-to-end).
> Use `sodax.api.bridge` for a single backend call, or when building your own flow. The Bridge API shares
> the swaps host — its routes are `/bridge/*` sub-paths under the same base URL.

## Methods

```ts
// Tokens
sodax.api.bridge.getTokens(config?): Promise<Result<GetBridgeTokensResponseV2>>;
sodax.api.bridge.getTokensByChain(chainKey, config?): Promise<Result<GetBridgeTokensByChainResponseV2>>;

// Allowance · approve · create intent — all three share the CreateBridgeIntentParamsV2 body
sodax.api.bridge.checkAllowance(body: CreateBridgeIntentParamsV2, config?): Promise<Result<BridgeAllowanceCheckResponseV2>>;
sodax.api.bridge.approve(body: CreateBridgeIntentParamsV2, config?): Promise<Result<BridgeApproveResponseV2>>;
sodax.api.bridge.createBridgeIntent(body: CreateBridgeIntentParamsV2, config?): Promise<Result<CreateBridgeIntentResponseV2>>;

// Submit-tx state machine
sodax.api.bridge.submitTx(body: BridgeSubmitTxRequestV2, config?): Promise<Result<BridgeSubmitTxResponseV2>>;
sodax.api.bridge.getSubmitTxStatus(query: BridgeSubmitTxStatusQueryV2, config?): Promise<Result<BridgeSubmitTxStatusResponseV2>>;
```

The optional trailing `config?: RequestOverrideConfig` (`{ baseURL?, timeout?, headers? }`) on every method
applies per-call overrides that take precedence over the service config (same as the swaps client).

## Deltas vs the Swaps API

Bridge is **vault-backed, not solver-based**, so the surface is smaller and a few shapes differ:

- **No `intent` struct.** `createBridgeIntent` returns `{ tx, relayData }` (no `intent`); `submitTx` carries
  no `intent` field; there is no quote / deadline / limit-order / cancel / intent-hash / packet surface.
- **`submitTx.relayData` is the FULL `{ address, payload }` object** (not the `.payload` string the swaps
  client takes). Bridge has no `intent.creator` for the backend to rebuild the relay address, so the client
  must send the whole envelope — dropping the address breaks split-tx-chain relay (Stellar/Solana/Sui/Stacks).
- **Status lifecycle is 5-state** (`'pending'` → `'relaying'` → `'relayed'` → `'executed'` | `'failed'`) —
  no swaps `'posting_execution'`. Terminal success is `status === 'executed' && result.dstIntentTxHash`
  (no solver `intent_hash`). The status schema is tolerant of unknown states.
- **Param naming follows the swaps wire convention** (`inputToken`/`outputToken`/`inputAmount`/`srcAddress`/
  `dstAddress`), NOT the SDK-domain `srcToken`/`dstToken`/`amount`/`recipient`. The mapper
  `toCreateBridgeIntentParamsV2(params, extras?)` converts SDK-domain params (and serializes the `bigint`
  amount) to this wire DTO.
- **Bridgeable-amount stays client-side** — there is no backend bridgeable-amount endpoint. Use
  `sodax.bridge.getBridgeableAmount(...)` + `sodax.bridge.isBridgeable({ from, to })`. The token *list* is
  backend-served via `getTokens` / `getTokensByChain`.

## Common call shapes

### Allowance · approve · create intent (shared body)

```ts
const body = {
  srcChainKey, dstChainKey,
  inputToken,                 // source token address (SDK domain `srcToken`)
  outputToken,                // destination token address (SDK domain `dstToken`)
  inputAmount: '1000000',     // smallest unit, decimal string (SDK domain `amount`, bigint → string)
  srcAddress, dstAddress,     // dstAddress is the SDK domain `recipient`
};

const allowance = await sodax.api.bridge.checkAllowance(body);
if (allowance.ok && !allowance.value.valid) {
  const approved = await sodax.api.bridge.approve(body);   // { tx } — sign + broadcast yourself
}

const created = await sodax.api.bridge.createBridgeIntent(body);
if (!created.ok) return;
const { tx, relayData } = created.value;                   // no `intent`
```

### Submit tx + poll status

```ts
// Sign + broadcast `tx` yourself, then hand the spoke tx hash back with the FULL relayData envelope.
const submit = await sodax.api.bridge.submitTx({
  txHash, srcChainKey, walletAddress,
  relayData,                       // the whole { address, payload } object, NOT relayData.payload
});
if (!submit.ok) return;

// Both txHash AND srcChainKey are required.
const status = await sodax.api.bridge.getSubmitTxStatus({ txHash, srcChainKey });
if (status.ok && status.value.data.status === 'executed') {
  status.value.data.result?.dstIntentTxHash;   // destination tx hash (no intent_hash)
}
// Lifecycle: 'pending' → 'relaying' → 'relayed' → 'executed' | 'failed'.
```

## Per-call overrides & custom endpoint

Every method accepts a trailing `RequestOverrideConfig` to redirect a single call or attach headers:

```ts
await sodax.api.bridge.getTokens({ baseURL: 'https://staging.example/v1/be', headers: { 'X-Trace': 'abc' } });
```

The Bridge API has no dedicated config slice — it always shares the base backend host (`/bridge/*`). To
move the whole backend (including bridge) to a custom host, use the `CustomApiConfig` `baseApiConfig` slice
(see [`backend-api.md`](backend-api.md) § "Custom backend").

## Orchestrator integration — `bridgeOptions.useBackendSubmitTx`

`new Sodax({ bridgeOptions: { useBackendSubmitTx: true } })` opts the end-to-end `sodax.bridge.bridge()`
into routing the spoke-deposit through this API (`submit-tx` + status poll) with an automatic fall back to
the client-side relay on any non-success. **Default OFF.** This is a distinct key from
`swapsOptions.useBackendSubmitTx`. See [`bridge.md`](bridge.md) and the `CONFIGURE_SDK` doc.

## Error handling

```ts
const r = await sodax.api.bridge.createBridgeIntent(body);
if (!r.ok) {
  // r.error: SodaxError<'EXTERNAL_API_ERROR'> — feature: 'backend', context.api: 'bridge',
  // context.endpoint: '/bridge/intents'. The transport / shape-validation failure is on r.error.cause.
  return;
}
```

## Cross-references

- `sodax.bridge` (the `BridgeService` orchestrator that deposits + relays end-to-end): [`bridge.md`](bridge.md).
- `sodax.api.swaps` (the sibling swaps HTTP client this mirrors): [`swaps-api.md`](swaps-api.md).
- `BackendApiService` (intent / orderbook / money-market reads + config): [`backend-api.md`](backend-api.md).
- Error model context fields: [`../reference/error-codes.md`](../reference/error-codes.md).
