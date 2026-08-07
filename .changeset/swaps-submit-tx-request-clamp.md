---
'@sodax/sdk': patch
---

Bound each swaps submit-tx status request by the poll cutoff, matching bridge. `SwapService.submitTx` dropped the per-request override `pollBackendSubmitTx` hands its `getStatus` callback, so a stalled status request ran on the full 30s backend-API default and could outlast the reserve held back for the client-side fallback — leaving the fallback relay its 5s floor and pushing total wall-clock past the caller's `timeout`. Adds `SwapsApiService.getTimeout()` (mirroring `BridgeApiService`) and passes it as `requestTimeoutMs`.
