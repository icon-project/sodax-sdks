# @sodax/bridge-api

Minimal, type-safe HTTP client for the SODAX backend **Bridge API v2**.

- Implements the `IBridgeApiV2` contract from `@sodax/types` over `fetch`.
- Validates every response at runtime with [valibot](https://valibot.dev), and
  transforms each chain-specific unsigned `tx` back to its domain shape
  (decimal-string → `bigint`, Injective index-object bytes → `Uint8Array`).
- Zero dependency on `@sodax/sdk`, viem, or wallet providers — only
  `@sodax/types` (types) and `valibot`.

It is the single source of the bridge wire client: `@sodax/sdk`'s `BridgeApiService`
(`sodax.api.bridge`) is a thin adapter over this package, adding the SDK's
`Result<T>` contract, logger, and config resolution on top. Use `@sodax/bridge-api`
directly when you want just the bridge backend without pulling in the full SDK.

## Install

```bash
pnpm add @sodax/bridge-api valibot
```

## Usage

```ts
import { BridgeApi, BridgeApiError } from '@sodax/bridge-api';

const api = new BridgeApi({ baseUrl: 'https://<bridge-api-host>' });

const tokens = await api.getTokens();
const { tx, relayData } = await api.createBridgeIntent({
  srcChainKey,
  dstChainKey,
  inputToken,
  outputToken,
  inputAmount, // smallest unit, decimal string
  srcAddress,
  dstAddress,
});
// …sign + broadcast `tx`, then hand the FULL relay envelope back:
await api.submitTx({ txHash, srcChainKey, walletAddress, relayData });
```

`baseUrl` is required and injected by the caller — the package never hardcodes
environment URLs. Optionally set `timeout` (ms — an overall per-call deadline that
includes retries; on expiry the call throws `TIMEOUT_ERROR`), a custom `fetch` (for
tests or non-standard runtimes; it receives the timeout `AbortSignal`), and extra `headers`.

Bridge deltas vs the swaps client worth knowing:

- `createBridgeIntent` returns `{ tx, relayData }` — there is **no** `intent` struct
  (the bridge is vault-backed, not solver-based).
- `submitTx` must carry the **full** `relayData { address, payload }` envelope
  received from `createBridgeIntent`, not just the payload.
- `getSubmitTxStatus` `status` is a tolerant `string`; compare against the known
  terminal literals (`'executed'` / `'failed'`).
- `getFee` / `getBridgeableAmount` / `isBridgeable` are read-only quotes also
  computable client-side; SDK consumers should prefer the local `sodax.bridge.*`
  equivalents (no round-trip) — these HTTP mirrors exist for non-SDK clients.

## Errors

Every method **throws** a `BridgeApiError` on failure — a single typed error whose
`code` is one of `NETWORK_ERROR` / `TIMEOUT_ERROR` / `HTTP_ERROR` / `PARSE_ERROR` /
`VALIDATION_ERROR`, with diagnostic `context` (endpoint, method, path, HTTP status,
validation issues) and the underlying failure on `.cause`. Idempotent calls (reads,
polls, pure-compute POSTs like `getFee`) are retried a few times on transient HTTP /
network failures; a `timeout` and mutating calls are never retried.

> Note: this throwing contract is intentional and distinct from `@sodax/sdk`'s
> `sodax.api.bridge`, which wraps these calls and returns `Result<T>` instead of throwing.
