---
"@sodax/types": minor
"@sodax/sdk": minor
---

Add `hook?: HookRequestV2` to `SwapExtrasV2`, the swap extras shared by every Swaps API v2
intent-building request body: `CreateIntentParamsV2` (`/swaps/allowance/check`, `/swaps/approve`,
`/swaps/intents`, and `/swaps/limit-orders` via `CreateLimitOrderParamsV2`) and `QuoteRequestV2`
(`/swaps/quote`). Until now the wire type had no way to express a delivery hook, so a hooked intent
could only be built client-side — `sodax.swaps` resolved the hook before handing the broadcast tx to
the backend, while the API's own intent builders could not select one at all.

`HookRequestV2` is `{ kind: HookKind }`, mirroring the SDK's `HookRequest`. `dstAddress` keeps its
meaning: it is the recipient the hook credits, not the delivery target — the hook's deployed address is
resolved from the registry and substituted server-side.

On `getQuote`, `hook` is only meaningful with `includeTxData: true` (a bare quote never builds an
intent, mirroring how the inherited `srcPublicKey`/`bound` extras already work there); a quote without
`includeTxData` ignores it.

This is the wire contract only. Whether a given deployment honours the field — on any of these
endpoints — depends on the backend forwarding it, and on that backend's pinned SDK having the
requested hook registered for `dstChainKey`; an unregistered kind fails the request rather than
silently falling back to a plain transfer. In particular, `getQuote` support is unverified from this
repo: the backend that implements `/swaps/quote` lives outside this monorepo, and nothing here proves
its `includeTxData=true` handler forwards `hook` into intent construction the way `/swaps/intents`
already does.
