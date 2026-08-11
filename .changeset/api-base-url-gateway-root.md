---
'@sodax/types': minor
'@sodax/sdk': minor
'@sodax/skills': patch
---

Fixed the packaged `api.baseURL` default sending the swaps and bridge clients to the wrong URL.
`DEFAULT_BACKEND_API_ENDPOINT` was `https://api.sodax.com/v1/be` — the gateway root plus the backend data
API's own `/be` mount — and every service resolved from it. Since the swaps and bridge routes already carry
their service segment, `new Sodax()` with no `api` config posted to `https://api.sodax.com/v1/be/swaps/submit-tx`
instead of `https://api.sodax.com/v1/swaps/submit-tx`, and likewise for `/bridge/*`. With
`swaps.useBackendSubmitTx` / `bridge.useBackendSubmitTx` now on by default, swaps and bridges silently fell
back to the client-side relay on the default config, and direct `sodax.api.swaps.*` / `sodax.api.bridge.*`
calls 404'd.

`baseURL` is now the **gateway root** for every service — origin plus the deployment's version prefix, and
never a service segment. Each service appends its own path below it:

| Service | Path | Default URL |
| --- | --- | --- |
| `sodax.backendApi` | `/be` | `https://api.sodax.com/v1/be/config/all` |
| `sodax.api.swaps` | `/swaps` | `https://api.sodax.com/v1/swaps/submit-tx` |
| `sodax.api.bridge` | `/bridge` | `https://api.sodax.com/v1/bridge/submit-tx` |
| `sodax.api.sponsoring` | `/sponsorships/stellar` | `https://api.sodax.com/v1/sponsorships/stellar/config` |

New exports from `@sodax/types` (re-exported by `@sodax/sdk`): `DEFAULT_API_BASE_URL`
(`https://api.sodax.com/v1`), `BACKEND_API_BASE_PATH` (`/be`), and `BackendApiConfig`
(`BaseApiConfig & { basePath?: string }`) — the backend data API's mount, which only it reads. Set
`basePath: ''` for a backend addressed directly at its origin rather than through the gateway:
`new Sodax({ api: { baseApiConfig: { baseURL: 'http://localhost:4000', basePath: '' } } })` requests
`http://localhost:4000/config/all`. `DEFAULT_BACKEND_API_ENDPOINT` is deprecated (its value is unchanged);
`DEFAULT_SPONSORING_API_ENDPOINT` is now an alias of `DEFAULT_API_BASE_URL`, same value as before.

**Migration.** Drop the `/be` suffix from any `baseURL` you pass — `'https://api.sodax.com/v1/be'` becomes
`'https://api.sodax.com/v1'`, and the SDK appends `/be` itself. The old value keeps working: the SDK trims
a trailing `/be` from the flat field, the `baseApiConfig`/`swapsApiConfig` slices and per-call `baseURL`
overrides, warns once per `Sodax` construction naming the trimmed root, and resolves the data API to
exactly the URLs it used before — while now also fixing the swaps and bridge routes it used to nest under
`/be`. Two exceptions: `sponsoringApiConfig.baseURL` is never trimmed (it resolves independently and its
default never carried the mount), and an explicit `basePath` stands the trim down entirely, so a deployment
genuinely served under `/be` can say `{ baseURL: 'https://host/be', basePath: '' }` and keep it. The
compatibility trim is scheduled for removal alongside the deprecated `DEFAULT_BACKEND_API_ENDPOINT` in the
next major.

Three observable changes:

- `sodax.backendApi.getBaseURL()` returns the gateway root rather than the request prefix — on the packaged
  default too, not only when you configured a base URL. Pair it with the new `getBasePath()`, or
  concatenate the two.
- A custom `baseURL` now has `/be` appended for data API routes. Pass `basePath: ''` if your deployment
  serves `/config/*`, `/intent/*`, … at its origin rather than behind the gateway.
- A per-call `RequestOverrideConfig.baseURL` replaces the gateway root; the calling service's own path
  still applies, so an override for `sodax.backendApi` still resolves under `/be`.

The version prefix stays in `baseURL` because it is deployment-owned: a locally-run service is reached by
swapping the host alone, with no prefix at all. `https://api.sodax.com` without `/v1` is therefore an
incomplete base URL — it shortens every service path by one segment, and since only the data API has a
`basePath` to compensate, the SDK warns at construction when a base URL on the packaged host omits it.

Sponsoring is otherwise unchanged: it still resolves its own base URL without inheriting, so pointing the
base API at a private proxy or a staging root never drags it along.
