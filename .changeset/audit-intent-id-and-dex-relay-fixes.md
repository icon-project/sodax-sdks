---
"@sodax/sdk": patch
---

Generate intent ids with a cryptographically secure RNG (`crypto.getRandomValues`) instead of `Math.random`, and fix the DEX liquidity withdraw relay destination to use the hub wallet address, unblocking Solana and Bitcoin relay submission.
