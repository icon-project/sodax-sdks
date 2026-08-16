---
"@sodax/sdk": minor
---

Fix `sodax.swaps.getStatus` reporting `NOT_FOUND` for intents that were already filled. The solver keeps intent state in memory, so a restart makes it forget them; `getStatus` now cross-checks the backend's durable intent record when the solver returns `NOT_FOUND` or the request fails, and returns `SOLVED` with the recovered `fill_tx_hash` when that record shows the input fully consumed. A partial fill (possible with `allowPartialFill`) is not reported as `SOLVED`.

Without fill evidence, the answer depends on whether the record could be read. A record showing no such fill — or a 404, the backend saying it holds none — settles it, so the solver's result stands. If the record could not be read at all (5xx, transport failure, unusable body), a solver `NOT_FOUND` is returned as a failed `Result` rather than an unverified miss, because the fill may exist and simply be unreadable. A poller that stops after N consecutive `NOT_FOUND` reads would otherwise spend that budget during a backend outage and give up on a swap that had completed. A failed solver request is still returned as-is.

Both directions are visible to callers, and `SolverErrorResponse` was already the declared error type, so neither is a type-level break: a solver failure the backend can resolve now succeeds where it previously failed, and a `NOT_FOUND` the backend cannot confirm now fails where it previously succeeded. Code that branches only on `ok: true` + `NOT_FOUND` should treat a failed read as "not yet known" and retry, which is what dapp-kit's `useStatus` and `useDetailedStatus` already do.

Add `isFillEvent` and the `FillEvent` type for reading `intent-filled` entries out of `IntentResponse.events`, which is typed `unknown[]`.
