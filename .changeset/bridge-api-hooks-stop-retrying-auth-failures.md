---
"@sodax/dapp-kit": patch
---

Stop the `useBridgeApi*` hooks from replaying a rejected API key.

Every bridge-API hook hardcoded `retry: 3`, so a terminal 401 (bad or missing key) or 403 (suspended organisation, or a key lacking the route's scope) cost four requests before the consumer saw the error — and nothing but a corrected key resolves either. `useBridgeApiSubmitTxStatus` was worse: `retry` bounds attempts within one poll tick, not the interval, so it re-requested against the rejected key every second indefinitely.

The ten retrying hooks now default to `retryUnlessAuthFailure`, the same policy the `useSwapsApi*` and `useLeverageYieldApi*` families already use — transport blips still retry up to 3 times, auth failures never do — and `useBridgeApiSubmitTxStatus` stops its poll on a rejected key alongside its existing `executed` / `failed` / `abandonedAt` stops. An invalid key now surfaces once, fast, on `error`.

No signature changes, and the defaults stay overridable through `queryOptions` / `mutationOptions` as before. `useBridgeApiApproveAndBroadcast` is unaffected: it signs and broadcasts real transactions and never retried.
