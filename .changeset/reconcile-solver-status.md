---
"@sodax/sdk": minor
---

Fix `sodax.swaps.getStatus` reporting `NOT_FOUND` for intents that were already filled. The solver keeps intent state in memory, so a restart makes it forget them; `getStatus` now cross-checks the backend's durable intent record when the solver returns `NOT_FOUND` or the request fails, and returns `SOLVED` with the recovered `fill_tx_hash` when a fill is recorded there. Without fill evidence the solver's result is returned unchanged.

One observable transition to be aware of: when the solver request itself fails but the backend proves the fill, `getStatus` now resolves `ok: true` where it previously resolved `ok: false`. No caller has to change code — an error branch simply stops firing for a case that is now answerable.

Add `isFillEvent` and the `FillEvent` type for reading `intent-filled` entries out of `IntentResponse.events`, which is typed `unknown[]`.
