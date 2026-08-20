---
"@sodax/types": patch
"@sodax/swaps-api": patch
"@sodax/sdk": patch
"@sodax/dapp-kit": patch
"@sodax/skills": patch
---

Document that Swaps API v2 `partnerFee` has no default — omit it and the swap charges nothing.
SDK `fee` / `swaps.partnerFee` config does not apply on this wire path (orchestrator only).
Docs only; no behavior change.
