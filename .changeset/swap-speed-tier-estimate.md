---
"@sodax/sdk": minor
"@sodax/skills": patch
---

Add `sodax.swaps.getSwapSpeedTier({ srcToken, dstToken })` — a synchronous, offline, rule-based estimate of how fast a swap token pair settles.

Derived purely from SDK config (no network, on-chain, or backend call), so consumers can show an approximate speed tier before a swap is submitted, e.g. an ETA badge next to the output amount. A token tied to a money-market-reserve (sodaAsset) settles faster (15s base) than the 35s default; an Ethereum leg (src or dst) adds a fixed 10s penalty, applied once even when both legs are Ethereum. `SwapSpeedTierResult` returns `{ tier: 'fast' | 'normal' | 'slow', estimatedSeconds }`.
