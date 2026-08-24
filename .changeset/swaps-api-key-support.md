---
"@sodax/types": minor
"@sodax/swaps-api": minor
"@sodax/sdk": minor
"@sodax/dapp-kit": minor
---

Add API-key support for backend requests: the backend is putting its routes (starting with `POST /swaps/*`) behind an `x-api-key` guard, and the SDKs now attach one instance-wide key everywhere. Set it once with `new Sodax({ apiKey })` and it is sent to the data API, the swaps API, the bridge API, the solver API, and sponsoring whenever sponsoring targets a SODAX gateway root; `api.sponsoringApiConfig.apiKey` stays the independent credential for a separately hosted sponsoring service and wins there. Override per request with `RequestOverrideConfig.apiKey` on every backend method, or with `extras.apiKey` on `sodax.swaps.swap()` and `sodax.bridge.bridge()` for their backend submit-tx legs; the standalone `@sodax/swaps-api` client takes `apiKey` in its constructor config. The wire client now also retries the apiguard's transient verification 503 with a short backoff — for every call, mutations included, since that rejection happens before the route handler runs — and exports the matched message as `API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE`.

Terminal auth failures are no longer repeated. `isAuthFailure` (new, from `@sodax/sdk`) identifies the guard's terminal `401`/`403`, and the SDK's backend submit-tx poll now returns as soon as the status endpoint rejects the key rather than re-requesting until the attempt budget expires — so `swap()` reaches its client-side fallback immediately. In `@sodax/dapp-kit`, every retrying `useSwapsApi*` hook defaults to the new exported `retryUnlessAuthFailure` predicate instead of a blanket `retry: 3`, and `useSwapsApiStatus` / `useSwapsApiSubmitTxStatus` stop polling once the key is rejected. Override either through `queryOptions` / `mutationOptions` as before. `BridgeApiService` now lifts the HTTP status onto `error.context` like its siblings, so `isAuthFailure` covers bridge failures too.
