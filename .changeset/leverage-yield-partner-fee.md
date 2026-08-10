---
"@sodax/sdk": minor
"@sodax/dapp-kit": minor
---

Fix leverage-yield vault intents reading the wrong configured partner fee, and add `sodax.leverageYield.getQuote()`.

`createVaultIntent` / `vaultSwap` defaulted to the effective **swap** fee (`swaps.partnerFee ?? fee`), so a configured `leverageYield.partnerFee` was silently ignored while `swaps.partnerFee` was charged on vault deposits and withdrawals. They now use the effective leverage-yield fee (`leverageYield.partnerFee ?? fee`). Explicit per-intent `partnerFee` overrides are unaffected, and a global-only `fee` behaves as before.

**Action required, two steps** if you set `swaps.partnerFee` and relied on it applying to leverage-yield flows.

1. Set `leverageYield.partnerFee` (or the global `fee`) to keep charging a fee on vault flows.

```ts
// before — vault intents were charged swaps.partnerFee
const sodax = new Sodax({ swaps: { partnerFee } });
// after — vault intents are charged leverageYield.partnerFee (or the global fee)
const sodax = new Sodax({ swaps: { partnerFee }, leverageYield: { partnerFee } });
```

2. Re-point vault quotes from `sodax.swaps.getQuote` to the new `sodax.leverageYield.getQuote`. This is required, not optional: `swaps.getQuote` still deducts the *swap* fee, so once the two feature fees differ the quote and the intent disagree — and when the leverage-yield fee is the larger one, the `minOutputAmount` derived from that quote exceeds what the intent can deliver and the intent will not fill.

```ts
// before — quote deducted swaps.partnerFee, which the intent no longer charges
const quote = await sodax.swaps.getQuote({ ...request });
// after — quote deducts the same effective leverage-yield fee the intent will charge
const quote = await sodax.leverageYield.getQuote({ ...request });
```

`sodax.leverageYield.getQuote(payload)` quotes a vault deposit (`token_dst` = vault) or withdraw (`token_src` = vault). Pass the same per-intent `partnerFee` to it that you pass to `deposit()` / `withdraw()` / `vaultSwap()`, or omit it on both — either way the two sides agree. It returns a `Result`; on failure `error` is the solver's `SolverErrorResponse` or a SodaxError (`VALIDATION_FAILED` / `LOOKUP_FAILED` / `UNKNOWN`).

`LeverageYieldSwapWithdrawParams` now accepts an optional `partnerFee`, matching `deposit()`. Omitting it is unchanged behavior (the configured leverage-yield fee applies), so existing withdraw calls need no edit.

Note that **withdrawals are charged too** — they always were, and the per-intent override was simply unreachable through `withdraw()` before. A withdraw's input token is the vault, so its fee is deducted in `lsoda*` shares and the receiver accrues vault shares rather than the output token. Both denominations are claimable through `sodax.partners.feeClaim`.

Adds the `useLeverageYieldQuote` hook to `@sodax/dapp-kit`, wrapping `sodax.leverageYield.getQuote`. Use it instead of `useQuote` for vault flows; it returns the SDK `Result` as `data` (branch on `data?.ok`), matching `useQuote` rather than the other leverage-yield read hooks.
