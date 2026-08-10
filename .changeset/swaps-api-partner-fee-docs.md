---
"@sodax/types": patch
"@sodax/swaps-api": patch
"@sodax/sdk": patch
"@sodax/dapp-kit": patch
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
`sodax-sdk/swaps-api` skill lists omitting the field as an anti-pattern. The `useSwapsApiQuote` /
`useSwapsApiCreateIntent` docstrings carry the same rule, since those hooks forward the body verbatim.

Three scoping facts the docs now spell out, because each is easy to get backwards:

- Only `/swaps/quote` and `/swaps/intents` read `partnerFee`. `/swaps/allowance/check` and
  `/swaps/approve` inherit the field from the shared `CreateIntentParamsV2` body and ignore it — both
  size the allowance off the full `inputAmount`.
- "No default" is about `/swaps/*` only. `CreateBridgeIntentParamsV2` and `POST /bridge/fee` treat
  `partnerFee` as a per-request override over the backend's configured `bridgePartnerFee`.
- The fee envelope's byte layout is no longer stated; callers never decode `intent.data` themselves.

The `PartnerFee` examples in `MONETIZE_SDK.md` no longer use the zero address as the fee receiver.
Nothing validates that address — `EvmSolverService` forwards it verbatim — so a copied placeholder
burns every fee as silently as omitting the field, while looking correct in review. The same file
uses the zero address one section later to mean "any solver", which made the collision easy to hit.
