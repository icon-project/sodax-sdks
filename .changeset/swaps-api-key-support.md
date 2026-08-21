---
"@sodax/types": minor
"@sodax/swaps-api": minor
"@sodax/sdk": minor
"@sodax/dapp-kit": minor
---

Add API-key support for the swaps flow: the backend is putting `POST /swaps/*` behind an `x-api-key` guard, and the SDKs can now attach the key everywhere partner fees are configured. Set it globally (`new Sodax({ apiKey })`), per feature (`new Sodax({ swaps: { apiKey } })`), on the transport slice (`api.swapsApiConfig.apiKey`), or per request — `RequestOverrideConfig.apiKey` on every `sodax.api.swaps` method and `extras.apiKey` on `sodax.swaps.swap()`; the standalone `@sodax/swaps-api` client takes `apiKey` in its constructor config. The winning config layer is readable via `sodax.config.swapsApiKey`. The wire client now also retries the apiguard's transient verification 503 with a short backoff — for every call, mutations included, since that rejection happens before the route handler runs — and exports the matched message as `API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE`.

Terminal auth failures are no longer repeated. `isAuthFailure` (new, from `@sodax/sdk`) identifies the guard's terminal `401`/`403`, and the SDK's backend submit-tx poll now returns as soon as the status endpoint rejects the key rather than re-requesting until the attempt budget expires — so `swap()` reaches its client-side fallback immediately. In `@sodax/dapp-kit`, every `useSwapsApi*` hook defaults to the new exported `retryUnlessAuthFailure` predicate instead of a blanket `retry: 3`, and `useSwapsApiStatus` / `useSwapsApiSubmitTxStatus` stop polling once the key is rejected. Override either through `queryOptions` / `mutationOptions` as before.
