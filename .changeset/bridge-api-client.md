---
'@sodax/types': minor
'@sodax/sdk': minor
'@sodax/dapp-kit': minor
---

Add a Bridge API client mirroring the Swaps API. `sodax.api.bridge` is a typed, validated HTTP client for the backend `/bridge/*` routes, backed by the `IBridgeApiV2` contract and DTOs in `@sodax/types`. `BridgeService` gains a backend submit-tx path behind `bridge.useBackendSubmitTx` (on by default, automatic fall back to the client-side relay) plus a per-request `partnerFee`, and `SodaxErrorContext.api` accepts `'bridge'`. `@sodax/dapp-kit` adds the matching `useBridgeApi*` hooks for allowance, approve, create intent, submit tx, submit-tx status, fee, bridgeable amount, tokens, and tokens by chain.
