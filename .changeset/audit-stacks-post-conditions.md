---
"@sodax/sdk": patch
"@sodax/libs": minor
---

Stacks deposits now sign with post-condition mode `Deny` and exact spend caps (one fungible-token cap per asset the token contract defines, or uSTX for native), and `sendMessage` signs with `Deny` and no conditions — wallets display the exact spend instead of an unconstrained `Allow` transaction. `@sodax/libs` re-exports `Pc` from `@stacks/transactions`.
