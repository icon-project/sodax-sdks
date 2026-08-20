---
"@sodax/dapp-kit": patch
"@sodax/sdk": patch
---

Fix `useQuote` caching a quote priced with the wrong partner fee, and read the swap / money-market partner fee live off config.

`useQuote`'s query key omitted the configured partner fee, which `swaps.getQuote` deducts from `amount` before quoting. Two `SodaxProvider`s configured with different fees shared one cache entry, and a reconfigured provider served the previous fee's quote until the next poll — a `minOutputAmount` derived from either can be unfillable. The effective fee is now part of the key. The key also lists its fields explicitly and stringifies `amount` defensively, so a payload still missing `amount` no longer throws while React Query derives the key.

`SwapService.partnerFee` and `MoneyMarketService.partnerFee` changed from constructor snapshots to getters that read `config.swapPartnerFee` / `config.moneyMarketPartnerFee` live, matching `BridgeService` and `LeverageYieldService`. Reading `sodax.swaps.partnerFee` is unchanged for callers; the values cannot now drift from the config object they came from. One nuance if you enumerate a service instance rather than reading the property: a getter is not an own enumerable property, so `partnerFee` no longer appears in `Object.keys(sodax.swaps)`, `{ ...sodax.swaps }` or `JSON.stringify(sodax.swaps)` — read `sodax.swaps.partnerFee` (or `sodax.config.swapPartnerFee`) directly instead.

Also exports `getSwapQuoteQueryOptions` from `@sodax/dapp-kit` for callers driving `useQueries` or prefetch directly, mirroring the leverage-yield equivalent.
