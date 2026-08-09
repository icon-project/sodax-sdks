---
'@sodax/sdk': minor
---

Give the backend submit-tx attempt and the client-side relay fallback independent `timeout` budgets.

`swap()` and `bridge()` previously ran both completion paths off one shared deadline, with the status poll holding back a reserve (a third of the remaining budget, capped at 20s) for the fallback. With the backend path now on by default, that reserve became the client-side relay's whole budget: a chain whose relay needs longer than ~20s failed with `RELAY_TIMEOUT` where it previously succeeded, and raising `timeout` did not help because the cap binds from a 60s `timeout` upward.

`timeout` is now a **per-attempt** budget. The backend attempt (submit POST plus status poll) gets it, and if that attempt does not complete the client-side relay wait gets a fresh one — starting after on-chain verification, so a slow source-chain confirmation no longer eats into it either. Raising `timeout` grows both attempts.

Each backend request (the POST included) is clamped to `min(budget left in the attempt, api.timeout)`, so a request can never be configured to outlive the attempt — previously the POST ran on the full `api.timeout` regardless of the caller's `timeout`, and could spend the fallback's reserve before polling began. Note this bounds a request, it does not guarantee a retry: once the attempt's remaining budget drops below `api.timeout`, one stalled request can spend what is left. Adds `SwapsApiService.getTimeout()`, mirroring `BridgeApiService`.

Worst-case wall-clock is `createIntent + timeout + verification + max(timeout, RELAY_FALLBACK_FLOOR_MS) + postExecution` — intent creation, verification (bounded by the source chain's own `pollingConfig.maxTimeoutMs`) and post-execution have never been bounded by `timeout`. `docs/SWAPS.md` now documents the per-phase bounds as formulas over the source constants instead of fixed numbers.

Verification is unchanged: the backend runs its own, so `verifyTxHash` still runs only on the client-side path.
