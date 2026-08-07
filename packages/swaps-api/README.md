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
  // Send this on every quote and intent, or the swap earns nothing and is
  // attributed to nobody. See "Partner fees" below.
  partnerFee: { address: partnerReceiverOnSonic, percentage: 10 }, // 10 bps = 0.1%
});
```

`baseUrl` is required and injected by the caller — the package never hardcodes
environment URLs. Optionally set `timeout` (ms — an overall per-call deadline that
includes retries; on expiry the call throws `TIMEOUT_ERROR`), a custom `fetch` (for
tests or non-standard runtimes; it receives the timeout `AbortSignal`), and extra `headers`.

## Partner fees

`partnerFee` is an optional body field on `getQuote` (`POST /swaps/quote`) and on the
shared `CreateIntentParamsV2` body used by `checkAllowance` / `approve` / `createIntent`
— but **optional here means "the caller owns it", not "the backend fills it in"**.

There is no default. The backend cannot pick one, because only the caller knows which
receiver to credit, and this package sends the request body exactly as you pass it —
it accepts no fee configuration of its own. Omitting the field means the swap charges
no fee **and** is unattributable, since the partner receiver is decoded out of the
`intent.data` the API builds. A quote without it returns the gross amount; the same
quote with `percentage: 10` returns exactly 10 bps less.

```ts
const partnerFee = { address: partnerReceiverOnSonic, percentage: 10 }; // 10 = 0.1%, 100 = 1%

// Pass the same value to the quote and to the intent, so the quoted output matches
// what the intent actually locks in.
const quote = await api.getQuote({ ...quoteBody, partnerFee });
const intent = await api.createIntent({ ...intentBody, partnerFee });
```

Two things that trip people up:

- Passing `data: '0x'` alongside `partnerFee` does **not** clobber the fee — the API
  builds `intent.data` itself and your `data` does not overwrite the fee envelope.
- The approval amount is unchanged (still the full input), so adding the fee never
  breaks an existing allowance step.

Use `amount` (a decimal string in the input token's smallest unit) instead of
`percentage` for a flat fee; if both are present the backend uses `amount`.

Note that the `Sodax` client options (`new Sodax({ fee })` /
`new Sodax({ swaps: { partnerFee } })`) do **not** apply here. Those are resolved
client-side and only reach the `sodax.swaps` orchestrator. See
[MONETIZE_SDK.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/MONETIZE_SDK.md)
for the two integration paths side by side.

## Errors

Every method **throws** a `SwapsApiError` on failure — a single typed error whose
`code` is one of `NETWORK_ERROR` / `TIMEOUT_ERROR` / `HTTP_ERROR` / `PARSE_ERROR` /
`VALIDATION_ERROR`, with diagnostic `context` (endpoint, method, path, HTTP status,
validation issues) and the underlying failure on `.cause`. Idempotent calls (reads,
polls, pure-compute POSTs like `getQuote`) are retried a few times on transient HTTP /
network failures; a `timeout` and mutating calls are never retried.

> Note: this throwing contract is intentional and distinct from `@sodax/sdk`'s
> `sodax.api.swaps`, which wraps these calls and returns `Result<T>` instead of throwing.
