---
title: "SODAX HTTP API"
description: "Wire-level reference for the public SODAX HTTP API — base URLs, route prefixes, and the conventions shared by every endpoint."
---

SODAX exposes a public HTTP API for protocol data and swap execution. This section documents it at the **wire level** — plain requests and responses, usable from any language.

If you are building in TypeScript, use the SDK instead: it wraps these endpoints with typed clients, runtime response validation, and a `Result<T>` error channel. See [`BACKEND_API.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/BACKEND_API.md) and [`SWAPS_API.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS_API.md). These pages are the reference underneath it.

## Base URLs

| Environment | Base URL | Use for |
|---|---|---|
| **Production** | `https://api.sodax.com` | Everything. |
| Canary | `https://canary-api.sodax.com` | Pre-release verification only. Runs ahead of production and may change without notice — do not build against it. |

Both hosts serve the same route prefixes; some surfaces exist only on canary while they are still being rolled out.

## Route prefixes

Every path below is relative to a base URL above. The prefix is meaningful — it selects which service handles the request — so it must be included in full.

| Prefix | Serves |
|---|---|
| `/v1/be/*` | Backend data API: protocol config, partners, money market, AMM, solver orderbook, oracle price candles, SODA supply. |
| `/v2/be/config/*` | Protocol configuration, v2 shape. |
| `/v1/intent/*` | Solver API: quote, execute, status. See [`SOLVER_API_ENDPOINTS.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SOLVER_API_ENDPOINTS.md). |
| `/v1/swaps/*` | Swaps v2: quote, approve, submit, status polling. |
| `/v1/bes/*` | Stateful API. Interactive OpenAPI UI at [`/v1/bes/docs`](https://api.sodax.com/v1/bes/docs). |
| `/v2/bes/register` | User registration. |

The version is part of the path, and versions coexist — `/v1/be/config/*` and `/v2/be/config/*` are both live and serve different shapes.

## Conventions

These hold across the API. Individual pages document only where they differ.

### Authentication

Read endpoints are unauthenticated `GET`s. No API key, no signature, no CORS restriction — they are safe to call directly from a browser.

### Numbers

Any value that a JSON number would damage — large integers such as token amounts, and prices carrying more significant digits than a `double` holds — is serialized as a **string**:

```json
{ "open": "1665.57", "high": "1666.22" }
```

```
GET /v1/be/sodax/total_supply
1499671267.8525950947157713
```

Parse these with `BigInt` or a decimal library. `Number()` silently truncates: the supply figure above comes back as `1499671267.852595`, ten fractional digits short.

Counts and timestamps that are safely within range stay JSON numbers — `{"filledCount": 141837}`.

### Timestamps

UNIX **seconds**, not milliseconds.

### Caching

Responses are cached server-side on a seconds-scale window. Polling faster than the window returns the same payload, so it buys you nothing. Each page documents its own window.

Read endpoints send a weak `ETag` and honour `If-None-Match`, so a poller can skip re-downloading an unchanged payload:

```bash
curl -s -D- -o /dev/null https://api.sodax.com/v1/be/oracle/markets | grep -i etag
# etag: W/"319-AoMQadrF9GEZWYlx1LKeFt0/Lc4"

curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'If-None-Match: W/"319-AoMQadrF9GEZWYlx1LKeFt0/Lc4"' \
  https://api.sodax.com/v1/be/oracle/markets
# 304
```

### Errors

Two shapes, and telling them apart matters:

**Gateway** — the path matched no published route. The request never reached a service:

```json
{ "ok": false, "error": "route_not_found" }
```

Returned with `404`. It almost always means a wrong or missing prefix — check the table above. A bare backend path such as `/oracle/markets`, without the `/v1/be` prefix, produces exactly this.

**Application** — the request reached the service and was rejected:

```json
{
  "message": "interval must be one of: 1m, 5m, 1h, 1d",
  "error": "Bad Request",
  "statusCode": 400
}
```

`message` is human-readable and describes the specific problem; when several validation rules fail it carries all of them, separated by `; `.

### Empty results

Some collection queries answer `200` with an empty collection rather than `404` — an oracle symbol with no data returns `{"symbol":"NOPE","quote":"USD","interval":"1h","candles":[]}`. Each page states its own behaviour; do not assume `404` means "no data".

## Quick check

Confirm a base URL and prefix are right before debugging anything else:

```bash
curl -s https://api.sodax.com/v1/be/healthz
```

```jsonc
// abridged
{
  "status": "ok",
  "service": "api",
  "aggregatorBlockHeight": "77137135",
  "now": "2026-08-06T13:43:53.089Z",
  "acceptTraffic": true
}
```

A `route_not_found` here means the prefix is wrong, not that the API is down.
