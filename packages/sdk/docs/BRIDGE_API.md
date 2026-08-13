# Bridge API — `BridgeApiService`

Typed HTTP client for the backend **Bridge API v2** (`/bridge/*`). Reached on the `Sodax` facade as
`sodax.api.bridge` — `sodax.api` is an alias for `sodax.backendApi`, and `.bridge` is the
`BridgeApiService` instance.

It mirrors `IBridgeApiV2` (from `@sodax/types`) one method per endpoint. Every method:

- returns `Promise<Result<T>>` — it **never throws**;
- validates the JSON response at runtime against a valibot schema (a contract drift is surfaced as
  `{ ok: false }`, not returned untyped);
- accepts an optional trailing `RequestOverrideConfig` (`{ baseURL?, timeout?, headers? }`) for per-call
  overrides.

> This is the lower-level backend HTTP surface. For the end-to-end deposit→relay bridge orchestrator, use
> `sodax.bridge` (see [`BRIDGE.md`](BRIDGE.md)). It mirrors [`SWAPS_API.md`](SWAPS_API.md) minus the
> solver/intent surface.

## Methods

```typescript
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

// Discovery / quote — read-only (computable client-side via sodax.bridge.*; mirrored here for HTTP parity)
sodax.api.bridge.getFee(body: BridgeFeeRequestV2, config?): Promise<Result<BridgeFeeResponseV2>>;
sodax.api.bridge.getBridgeableAmount(body: BridgeQuoteRequestV2, config?): Promise<Result<BridgeableAmountResponseV2>>;
sodax.api.bridge.isBridgeable(body: BridgeQuoteRequestV2, config?): Promise<Result<BridgeableCheckResponseV2>>;
```

## Deltas vs the Swaps API

Bridge is vault-backed (not solver-based), so the surface is smaller and a few shapes differ from
[`SWAPS_API.md`](SWAPS_API.md):

- **No `intent` struct.** `createBridgeIntent` returns `{ tx, relayData }` (no `intent`); there is no
  quote/deadline/limit-order/cancel/hash/packet surface.
- **`submitTx.relayData` is the FULL `{ address, payload }` object**, not the `.payload` string the swaps
  client takes — bridge has no `intent.creator` for the backend to rebuild the relay address, so the whole
  envelope must be sent (dropping the address breaks split-tx-chain relay).
- **Status lifecycle is 5-state** (`'pending'` → `'relaying'` → `'relayed'` → `'executed'` | `'failed'`) —
  no `'posting_execution'`. Terminal success is `status === 'executed' && result.dstIntentTxHash` (no
  solver `intent_hash`). The status schema is tolerant of unknown states.
- **Param naming follows the swaps wire convention** (`inputToken`/`outputToken`/`inputAmount`/`srcAddress`/
  `dstAddress`). The exported mapper `toCreateBridgeIntentParamsV2(params, extras?)` converts SDK-domain
  params (`srcToken`/`dstToken`/`amount`/`recipient`, serializing the `bigint` amount) to this wire DTO.
- **Discovery quotes (`getFee` / `getBridgeableAmount` / `isBridgeable`) are computable client-side.**
  Prefer `sodax.bridge.getFee(...)` / `getBridgeableAmount(...)` / `isBridgeable({ from, to })` (no
  round-trip). They *also* have backend endpoints (listed above), mirrored on this client for non-SDK HTTP
  callers / parity. The token *list* is backend-served via `getTokens` / `getTokensByChain`.

## Examples

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax();

const body = {
  srcChainKey, dstChainKey, inputToken, outputToken,
  inputAmount: '1000000', srcAddress, dstAddress,
};

// Allowance → approve (sign + broadcast the returned tx yourself)
const allowance = await sodax.api.bridge.checkAllowance(body);
if (allowance.ok && !allowance.value.valid) {
  const approved = await sodax.api.bridge.approve(body); // { tx }
}

// Create intent → submit tx → poll status
const created = await sodax.api.bridge.createBridgeIntent(body);
if (!created.ok) return;
const { tx, relayData } = created.value; // no `intent`

const submit = await sodax.api.bridge.submitTx({
  txHash, srcChainKey, walletAddress,
  relayData, // the full { address, payload } object, NOT relayData.payload
});
if (!submit.ok) return;

// Both txHash AND srcChainKey are required.
const status = await sodax.api.bridge.getSubmitTxStatus({ txHash, srcChainKey });
if (status.ok && status.value.data.status === 'executed') {
  status.value.data.result?.dstIntentTxHash; // destination tx hash (no intent_hash)
}
// Lifecycle: 'pending' → 'relaying' → 'relayed' → 'executed' | 'failed'.
```

## Status fields — two distinct `status` values

| Call | Field | Type | Values |
|---|---|---|---|
| `submitTx` | `BridgeSubmitTxResponseV2.data.status` | string | `'inserted'` (new) or `'duplicate'` (already submitted — idempotent on `(txHash, srcChainKey)`). |
| `getSubmitTxStatus` | `BridgeSubmitTxStatusResponseV2.data.status` | string | `'pending'` / `'relaying'` / `'relayed'` / `'executed'` / `'failed'` (last two terminal). |

## Configuration

`sodax.api.bridge` shares the backend API config: `baseURL` is the gateway root and the bridge client
appends `/bridge/*` below it — a sibling of the data API's `/be` mount, not a child of it, so a `baseURL`
must never carry a service segment. There is no dedicated bridge config slice — to
move the whole backend (bridge included) to a custom host, set the `baseApiConfig` of the `CustomApiConfig`
variant of `SodaxConfig.api` (see [`SWAPS_API.md`](SWAPS_API.md) § Configuration and
[`BACKEND_API.md`](BACKEND_API.md)).

The end-to-end orchestrator routes through this API by default via `bridge.useBackendSubmitTx`
(default ON); set `new Sodax({ bridge: { useBackendSubmitTx: false } })` to force the client-side
relay — see [`CONFIGURE_SDK.md`](CONFIGURE_SDK.md) and [`BRIDGE.md`](BRIDGE.md).

## Result\<T\> and Error Handling

Every method returns `Result<T, SodaxError<'EXTERNAL_API_ERROR'>>`. On any failure (network, timeout,
non-2xx HTTP, or response-shape mismatch), the result is `{ ok: false }` with a `SodaxError` carrying
`feature: 'backend'`, `context.api: 'bridge'`, and `context.endpoint` (the path); the underlying transport
failure is preserved on `error.cause`.

```typescript
const r = await sodax.api.bridge.createBridgeIntent(body);
if (!r.ok) {
  // r.error.feature === 'backend'; r.error.context.api === 'bridge'; r.error.context.endpoint === '/bridge/intents'
  // r.error.cause: the HTTP_REQUEST_FAILED / REQUEST_TIMEOUT / validation failure
  return;
}
```

## See also

- [`BRIDGE.md`](BRIDGE.md) — `sodax.bridge` (`BridgeService`), the end-to-end vault bridge orchestrator.
- [`SWAPS_API.md`](SWAPS_API.md) — `sodax.api.swaps`, the sibling swaps HTTP client this mirrors.
- [`BACKEND_API.md`](BACKEND_API.md) — `sodax.backendApi`, the read client for intent/orderbook/money-market reads + config.
