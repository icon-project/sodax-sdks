---
'@sodax/types': minor
'@sodax/sdk': patch
---

Reject native-BTC swap and bridge amounts below the Bitcoin dust limit instead of letting the transfer fail downstream. `BITCOIN_DUST_SATS` and `isNativeBitcoinToken` are now exported from `@sodax/types` as the single source of truth for both services.
