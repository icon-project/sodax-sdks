---
name: sodax-sdk-money-market
description: 'Granular skill for the @sodax/sdk v2 money-market feature only — cross-chain lending and borrowing (supply, borrow, withdraw, repay) and per-position reads. Use when the consumer task is specifically money-market (e.g. "supply on Sodax", "borrow against my position", "Sodax lending", "withdraw collateral", "repay debt", "cross-chain borrow"). Covers BOTH integration (write new v2 code) and migration (port v1 MoneyMarketService to v2). Skill links into the parent sodax-sdk knowledge tree — does NOT duplicate it. For React dapps, prefer the sodax-dapp-kit skill.'
---

# Money Market (Core SDK granular skill)

Granular skill for the lending/borrowing feature of `@sodax/sdk` v2. Access via `sodax.moneyMarket`. Feature tag for errors: `'moneyMarket'`.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?**
2. **Which operation?** `supply`, `borrow`, `withdraw`, `repay`, or just position reads.
3. **Same-chain or cross-chain borrow?** `borrow` can deliver funds back to the source chain or to a different spoke chain.
4. **Signed flow or unsigned-tx (`createXxxIntent`)?**
5. **Need user-position reads** (aToken balance, reserves data, formatted summaries)? Those come from `sodax.backendApi`, not `MoneyMarketService` — load [`../backend-api/SKILL.md`](../backend-api/SKILL.md) alongside.

## Integration workflow

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DO NOT.
2. [`../integration/knowledge/features/money-market.md`](../integration/knowledge/features/money-market.md) — `MoneyMarketService` API, action params, hub-asset / aToken mapping.
3. Path-specific recipe:
   - Signed → [`../integration/knowledge/recipes/signed-tx-flow.md`](../integration/knowledge/recipes/signed-tx-flow.md)
   - Backend / unsigned → [`../integration/knowledge/recipes/raw-tx-flow.md`](../integration/knowledge/recipes/raw-tx-flow.md)
4. Gas estimation before action methods → [`../integration/knowledge/recipes/gas-estimation.md`](../integration/knowledge/recipes/gas-estimation.md).
5. Errors (`feature: 'moneyMarket'`) → [`../integration/knowledge/recipes/result-and-errors.md`](../integration/knowledge/recipes/result-and-errors.md) and [`../integration/knowledge/reference/error-codes.md`](../integration/knowledge/reference/error-codes.md).
6. Reading user position → load [`../backend-api/SKILL.md`](../backend-api/SKILL.md) for `BackendApiService.getMoneyMarketPosition`, `getAllMoneyMarketAssets`, etc.

### Money-market-specific anti-patterns

- **Confusing `token` (hub asset address) with the spoke-chain token address.** `MoneyMarketParams<K>.token` is the hub asset (a `0x...` address on Sonic), not the user's spoke-chain ERC20.
- **Skipping allowance check before `supply` / `repay`.** Use `isAllowanceValid` then `approve` with the action-discriminated args.
- **Calling reserve-data reads on `MoneyMarketService`.** Those live on `sodax.backendApi`.

## Migration workflow (v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md).
2. [`../migration-v1-to-v2/knowledge/features/money-market.md`](../migration-v1-to-v2/knowledge/features/money-market.md) — v1 `MoneyMarketError` → v2 `SodaxError<C>` with `feature: 'moneyMarket'`.
3. Add `srcChainKey` + `srcAddress` to every action params object — these were not in v1 shapes.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Every `await sodax.moneyMarket.<method>(...)` has `if (!result.ok)` branching.
3. `instanceof MoneyMarketError` → `isSodaxError(e) && e.feature === 'moneyMarket'`.

## Related granular skills (same family)

- [`../backend-api/SKILL.md`](../backend-api/SKILL.md) — reads (`BackendApiService`) for user position, asset metadata, suppliers/borrowers lists.
- [`../swap/SKILL.md`](../swap/SKILL.md) — when supplying collateral that requires an upstream swap.

For multi-feature tasks, load the broad [`sodax-sdk` skill](../SKILL.md).
