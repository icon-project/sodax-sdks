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
`Result<T>` contract, logger, and config resolution on top. Use `@sodax/swaps-api`
directly when you want just the swaps backend without pulling in the full SDK.

## Install

```bash
pnpm add @sodax/swaps-api
```

`valibot` is an ordinary runtime dependency, not a peer — your package manager
installs it automatically, so there is no separate install step. The build keeps
it **external** rather than inlining it, so it stays a single shared copy in your
dependency graph instead of a second one baked into `dist`.

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
});
```

`baseUrl` is required and injected by the caller — the package never hardcodes
environment URLs. Optionally set `timeout` (ms — an overall per-call deadline that
includes retries; on expiry the call throws `TIMEOUT_ERROR`), a custom `fetch` (for
tests or non-standard runtimes; it receives the timeout `AbortSignal`), and extra `headers`.

> Note: `quoteType: 'exact_input'` is currently the only supported quote type — the
> `QuoteTypeV2` union in `@sodax/types` has no other member yet.

## Configuration

The `SwapsApi` constructor takes a `SwapsApiConfig`:

| Option    | Type                     | Required | Description                                                                                                                                                                    |
| --------- | ------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl` | `string`                 | Yes      | Base URL of the Swaps API host, including any version prefix (e.g. `https://canary-api.sodax.com/v1`). The package never hardcodes environment URLs.                           |
| `timeout` | `number`                 | No       | Overall per-call deadline in ms, enforced with an `AbortController` across the entire call **including retries** — a hard ceiling on total latency. Omit for no timeout. On expiry the call rejects with a `TIMEOUT_ERROR`. |
| `fetch`   | `typeof globalThis.fetch`| No       | `fetch` implementation to use. Defaults to the global `fetch`. Inject a custom one for tests or non-standard runtimes; it receives the timeout `AbortSignal`, so it should forward `init.signal`. |
| `headers` | `Record<string, string>` | No       | Extra headers merged over the defaults on every request.                                                                                                                       |

## Methods

Each method maps one-to-one to an `ISwapsApiV2` endpoint. Path params are
`encodeURIComponent`-escaped by the client.

| Method                                       | HTTP   | Path                                  |
| -------------------------------------------- | ------ | ------------------------------------- |
| `getTokens()`                                | GET    | `/swaps/tokens`                       |
| `getTokensByChain(chainKey)`                 | GET    | `/swaps/tokens/{chainKey}`            |
| `getQuote(body, query?)`                     | POST   | `/swaps/quote`                        |
| `getDeadline(query?)`                        | GET    | `/swaps/deadline`                     |
| `checkAllowance(body)`                       | POST   | `/swaps/allowance/check`              |
| `approve(body)`                              | POST   | `/swaps/approve`                      |
| `createIntent(body)`                         | POST   | `/swaps/intents`                      |
| `submitIntent(body)`                         | POST   | `/swaps/intents/submit`               |
| `getStatus(body)`                            | POST   | `/swaps/intents/status`               |
| `cancelIntent(body)`                         | POST   | `/swaps/intents/cancel`               |
| `getIntentHash(body)`                        | POST   | `/swaps/intents/hash`                 |
| `getSolvedIntentPacket(body)`                | POST   | `/swaps/intents/packet`               |
| `getIntentSubmitTxExtraData(body)`           | POST   | `/swaps/intents/extra-data`           |
| `getFilledIntent(txHash)`                    | GET    | `/swaps/intents/{txHash}/fill`        |
| `getIntent(txHash)`                          | GET    | `/swaps/intents/{txHash}`             |
| `createLimitOrderIntent(body)`               | POST   | `/swaps/limit-orders`                 |
| `estimateGas(body)`                          | POST   | `/swaps/gas/estimate`                 |
| `getPartnerFee(query)`                       | GET    | `/swaps/fees/partner`                 |
| `getSolverFee(query)`                        | GET    | `/swaps/fees/solver`                  |
| `submitTx(body)`                             | POST   | `/swaps/submit-tx`                    |
| `getSubmitTxStatus(query)`                   | GET    | `/swaps/submit-tx/status`             |

## Errors

Every method **throws** a `SwapsApiError` on failure — a single typed error whose
`code` is one of `NETWORK_ERROR` / `TIMEOUT_ERROR` / `HTTP_ERROR` / `PARSE_ERROR` /
`VALIDATION_ERROR`, with diagnostic `context` (endpoint, method, path, HTTP status,
validation issues) and the underlying failure on `.cause`. Idempotent calls (reads,
polls, pure-compute POSTs like `getQuote`) are retried a few times on transient HTTP /
network failures; a `timeout` and mutating calls are never retried.

> Note: this throwing contract is intentional and distinct from `@sodax/sdk`'s
> `sodax.api.swaps`, which wraps these calls and returns `Result<T>` instead of throwing.

### `SwapsApiError.code`

`code` is one of the following `SwapsApiErrorCode` values:

| Code               | Meaning                                                         |
| ------------------ | -------------------------------------------------------------- |
| `NETWORK_ERROR`    | `fetch` threw (offline, DNS).                                  |
| `TIMEOUT_ERROR`    | The request exceeded the configured `timeout` (aborted).      |
| `HTTP_ERROR`       | Server returned a non-2xx status.                             |
| `PARSE_ERROR`      | 2xx body was missing or not valid JSON.                      |
| `VALIDATION_ERROR` | Body did not match the expected schema (or a request was malformed). |

### `SwapsApiError.context`

`context` carries best-effort diagnostics (`SwapsApiErrorContext`). All fields are optional:

| Field      | Type      | Description                                                                                   |
| ---------- | --------- | -------------------------------------------------------------------------------------------- |
| `endpoint` | `string`  | The `ISwapsApiV2` method that failed, e.g. `'getQuote'`.                                     |
| `method`   | `string`  | HTTP method actually sent, e.g. `'POST'`.                                                    |
| `path`     | `string`  | Request path actually sent, e.g. `'/swaps/quote'`.                                           |
| `status`   | `number`  | HTTP status, for `HTTP_ERROR`.                                                               |
| `body`     | `unknown` | Best-effort parsed backend response body (JSON if possible, else text), so the backend's message surfaces to the caller. |
| `issues`   | `unknown` | valibot issues, for `VALIDATION_ERROR`.                                                      |

The underlying failure is available on `.cause`.

## Reference app

For a full end-to-end flow — including wallet signing, which this package
deliberately leaves to the caller — see the
[`apps/swap-api-example`](https://github.com/icon-project/sodax-sdks/tree/main/apps/swap-api-example) reference app. It drives
`@sodax/swaps-api` through the complete quote → approve → create-intent →
sign → submit lifecycle.
