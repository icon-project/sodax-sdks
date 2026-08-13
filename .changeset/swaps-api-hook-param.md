---
"@sodax/types": minor
"@sodax/sdk": minor
---

Add `hook?: HookRequestV2` to `CreateIntentParamsV2`, the shared request body for the Swaps API v2
intent-building endpoints (`/swaps/allowance/check`, `/swaps/approve`, `/swaps/intents`). Until now the
wire type had no way to express a delivery hook, so a hooked intent could only be built client-side —
`sodax.swaps` resolved the hook before handing the broadcast tx to the backend, while the API's own
intent builders could not select one at all.

`HookRequestV2` is `{ kind: HookKind }`, mirroring the SDK's `HookRequest`. `dstAddress` keeps its
meaning: it is the recipient the hook credits, not the delivery target — the hook's deployed address is
resolved from the registry and substituted server-side.

This is the wire contract only. Whether a given deployment honours the field depends on the backend
forwarding it, and on that backend's pinned SDK having the requested hook registered for `dstChainKey`;
an unregistered kind fails the request rather than silently falling back to a plain transfer.
