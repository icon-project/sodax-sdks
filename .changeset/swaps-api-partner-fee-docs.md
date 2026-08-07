---
"@sodax/types": patch
"@sodax/swaps-api": patch
"@sodax/sdk": patch
"@sodax/skills": patch
---

Document that the Swaps API v2 requires `partnerFee` on the request body. `partnerFee` is optional
in the type system, which read as "the backend fills it in" — it does not, and cannot, because only
the caller knows which receiver to credit. `sodax.api.swaps` and `@sodax/swaps-api` serialize the
body as given and never consult the client-side `new Sodax({ fee })` / `new Sodax({ swaps: {
partnerFee } })` options; that config only reaches the `sodax.swaps` orchestrator. A `/swaps/quote`
or `/swaps/intents` call without the field therefore succeeds, charges nothing, and is
unattributable, since the backend decodes the partner receiver out of `intent.data`.

Docs only — no behavior change. The `SwapExtrasV2.partnerFee` docstring, the `@sodax/swaps-api`
quickstart, `MONETIZE_SDK.md` (which described monetization purely through the orchestrator) and
`SWAPS_API.md` now state the requirement and separate the two integration paths, and the
`sodax-sdk/swaps-api` skill lists omitting the field as an anti-pattern.
