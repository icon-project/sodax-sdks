# @sodax/swaps-api

Minimal, type-safe HTTP client for the SODAX backend **Swaps API v2**.

- Implements the `ISwapsApiV2` contract from `@sodax/types` over `fetch`.
- Validates every response at runtime with [valibot](https://valibot.dev), and
  transforms each chain-specific unsigned `tx` back to its domain shape
  (decimal-string → `bigint`, Injective index-object bytes → `Uint8Array`).
- Zero dependency on `@sodax/sdk`, viem, or wallet providers — only
  `@sodax/types` (types) and `valibot`.

It is the single source of the swaps wire client: `@sodax/sdk`'s `SwapsApiService`
(`sodax.api.swaps`) is a thin adapter over this package, adding the SDK's
`Result<T>` contract, logger, and transport-config resolution on top. Use
`@sodax/swaps-api` directly when you want just the swaps backend without pulling in
the full SDK.

## Install

```bash
pnpm add @sodax/swaps-api valibot
```

## Usage

```ts
import { SwapsApi, SwapsApiError } from '@sodax/swaps-api';

const api = new SwapsApi({ baseUrl: 'https://<swaps-api-host>' });

const tokens = await api.getTokens();
const quote = await api.getQuote({
  tokenSrc,
  tokenSrcChainKey,
  tokenDst,
  tokenDstChainKey,
  amount,
  quoteType: 'exact_input',
  partnerFee: { address: partnerReceiverOnSonic, percentage: 10 }, // 10 bps = 0.1%
});
```

`baseUrl` is required and injected by the caller — the package never hardcodes
environment URLs. Optionally set `timeout` (ms — an overall per-call deadline that
includes retries; on expiry the call throws `TIMEOUT_ERROR`), a custom `fetch` (for
tests or non-standard runtimes; it receives the timeout `AbortSignal`), extra `headers`,
and an `apiKey`.

## API key

The backend guards `POST /swaps/*` routes with an `x-api-key` header check (keys are
minted through the partner portal). Pass the key once at construction and the client
sends it on every request:

```ts
const api = new SwapsApi({ baseUrl: 'https://<swaps-api-host>', apiKey: 'partner-api-key' });
```

An explicit `headers: { 'x-api-key': ... }` wins over the `apiKey` convenience option.
For a different key per call, construct another client — instances are cheap and
stateless. Keys bundled into a browser app are public by nature.

Auth failures surface as `HTTP_ERROR` with the backend's status and message on
`context`: `401` (missing or invalid key) and `403` (suspended organisation or missing
scope) are terminal — fix the key, don't retry. The one transient case, a `503` whose
message is `API key verification is temporarily unavailable` (exported as
`API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE`), is retried automatically with a short
backoff — for every call, mutations included, since the guard rejects before the route
handler runs.

## Partner fees

`partnerFee` has no default — this client forwards the body as given and does not read
`new Sodax({ fee })` / `new Sodax({ swaps: { partnerFee } })`. Send the same value on
quote and create-intent:

```ts
const partnerFee = { address: partnerReceiverOnSonic, percentage: 10 }; // 10 = 0.1%, 100 = 1%

const quote = await api.getQuote({ ...quoteBody, partnerFee });
const intent = await api.createIntent({ ...intentBody, partnerFee });
```

`checkAllowance` / `approve` inherit the field but ignore it. See
[MONETIZE_SDK.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/MONETIZE_SDK.md)
for the orchestrator path.

## Errors

Every method **throws** a `SwapsApiError` on failure — a single typed error whose
`code` is one of `NETWORK_ERROR` / `TIMEOUT_ERROR` / `HTTP_ERROR` / `PARSE_ERROR` /
`VALIDATION_ERROR`, with diagnostic `context` (endpoint, method, path, HTTP status,
validation issues) and the underlying failure on `.cause`. Idempotent calls (reads,
polls, pure-compute POSTs like `getQuote`) are retried a few times on transient HTTP /
network failures; a `timeout` and mutating calls are never retried — except the
apiguard's verification `503` (see "API key" above), which is replay-safe and retried
for every call.

> Note: this throwing contract is intentional and distinct from `@sodax/sdk`'s
> `sodax.api.swaps`, which wraps these calls and returns `Result<T>` instead of throwing.

## Response schemas

The valibot schemas the client validates with are exported too, so a caller that already holds a
parsed response — or a sibling API whose wire shapes are identical — can reuse them instead of
re-declaring the contract. `@sodax/sdk`'s Leverage Yield client is exactly that case: a
leverage-yield deposit/withdraw **is** an intent-based swap, so it reuses these for its intent-relay,
gas, fee, and submit-tx responses.

- **Intent lifecycle:** `makeCreateIntentResponseSchema`, `makeCancelIntentResponseSchema`,
  `SubmitIntentResponseSchema`, `StatusResponseSchema`, `IntentHashResponseSchema`,
  `IntentPacketResponseSchema`, `IntentResponseSchema`, `RelayExtraDataResponseSchema`,
  `IntentStateSchema`
- **Quote · deadline · allowance · approve:** `makeQuoteResponseSchema`, `DeadlineResponseSchema`,
  `AllowanceCheckResponseSchema`, `makeApproveResponseSchema`
- **Gas · fees:** `GasEstimateResponseSchema`, `FeeResponseSchema`
- **Submit-tx state machine:** `SubmitTxResponseSchema`, `SubmitTxStatusResponseSchema`
- **Raw transactions:** `rawTxSchemaForChainKey(chainKey)` — the per-chain-family `tx` schema the
  `make*ResponseSchema` factories above take, which also transforms the unsigned tx back to its
  domain shape (decimal-string → `bigint`, Injective index-object bytes → `Uint8Array`)

```ts
import * as v from 'valibot';
import { makeApproveResponseSchema, rawTxSchemaForChainKey } from '@sodax/swaps-api';

const schema = makeApproveResponseSchema(rawTxSchemaForChainKey('sonic'));
const approve = v.parse(schema, await someOtherTransport('/approve'));
```

These are the response shapes only — request bodies are typed, not schema-validated.
