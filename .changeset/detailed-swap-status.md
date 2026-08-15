---
"@sodax/sdk": minor
"@sodax/dapp-kit": minor
"@sodax/skills": patch
---

Add `sodax.swaps.getDetailedStatus({ srcChainKey, srcTxHash })` and `useDetailedStatus` to monitor swaps from their source transaction. Results are tagged by source, and the hook polls until terminal or until 40 consecutive reads that cannot resolve the swap — a dependency outage keeps polling instead.
