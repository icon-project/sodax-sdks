---
"@sodax/sdk": patch
---

Fix `sodax.swaps.getStatus` reporting `NOT_FOUND` for intents that were already filled. The solver keeps intent state in memory, so a restart makes it forget them; `getStatus` now cross-checks the backend's durable intent record when the solver returns `NOT_FOUND` or the request fails. Adds `isFillEvent` and the `FillEvent` type for reading `intent-filled` entries out of `IntentResponse.events`.
