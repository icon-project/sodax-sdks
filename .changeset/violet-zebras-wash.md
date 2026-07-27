---
"@sodax/sdk": patch
---

Fix over-stated bnUSD debt by pinning the merged reserve's lastUpdateTimestamp to the debt token's, keeping its borrow index, rate, and timestamp consistent.
