---
"@sodax/sdk": minor
"@sodax/dapp-kit": minor
"@sodax/skills": patch
---

Add `sodax.swaps.getDetailedStatus({ srcChainKey, srcTxHash })` and `useDetailedStatus` to monitor swaps from their source transaction. Results are tagged by source, and the hook polls until terminal or until 40 consecutive reads that cannot resolve the swap — a dependency outage keeps polling instead.

Each read `getDetailedStatus` makes is bounded, so a relay or solver that stops responding mid-request cannot leave the poll hanging with no result to act on. An expired read is reported as a dependency failure, which stays retryable rather than counting against the not-delivered budget.

`getTransactionPackets(payload, apiUrl, timeoutMs?)` and `SolverApiService.getStatus(request, config, logger?, timeoutMs?)` each take an optional budget for this. Both are opt-in: omit the argument and the call behaves exactly as before, including `sodax.swaps.getStatus`, which stays unbounded because a one-shot read is the caller's to bound. `RELAY_REQUEST_TIMEOUT_MS` is now exported as a sound default for the first of those.
