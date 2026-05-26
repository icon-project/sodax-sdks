---
name: sodax-sdk-dex
description: 'Granular skill for the @sodax/sdk v2 DEX feature only — Uniswap-V3-style concentrated liquidity positions on the hub, plus AssetService for hub-asset deposit/withdraw. Use when the task is LP positions (e.g. "Sodax concentrated liquidity", "create LP position on Sodax", "increase liquidity", "decrease liquidity", "claim LP fees", "deposit hub assets for LP"). Covers BOTH integration and migration. Skill links into the parent sodax-sdk knowledge tree. For React dapps, prefer sodax-dapp-kit.'
---

# DEX (Core SDK granular skill)

Granular skill for `DexService` — facade owning `clService: ClService` (concentrated liquidity) and `assetService: AssetService` (hub-asset deposit/withdraw). Access via `sodax.dex.clService` and `sodax.dex.assetService`. Feature tag for errors: `'dex'`.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?**
2. **Which operation?**
   - LP: `createPosition`, `increaseLiquidity`, `decreaseLiquidity`, `claimFees`, `closePosition`.
   - Assets: `deposit` (spoke → hub-asset wrapper), `withdraw` (hub → spoke).
3. **Does the position require an asset deposit first?** LP positions hold hub assets; the user must deposit from a spoke chain before opening a position.
4. **Signed or unsigned-tx flow?**

## Integration workflow

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md).
2. [`../integration/knowledge/features/dex.md`](../integration/knowledge/features/dex.md) — `ClService` + `AssetService` APIs, position lifecycle, tick math notes.
3. Path-specific recipe:
   - Signed → [`../integration/knowledge/recipes/signed-tx-flow.md`](../integration/knowledge/recipes/signed-tx-flow.md)
   - Unsigned → [`../integration/knowledge/recipes/raw-tx-flow.md`](../integration/knowledge/recipes/raw-tx-flow.md)
4. Errors (`feature: 'dex'`) → [`../integration/knowledge/reference/error-codes.md`](../integration/knowledge/reference/error-codes.md).

### DEX-specific anti-patterns

- **Reaching for `sodax.cl` / `sodax.assets`.** Wrong paths — both services are reached via `sodax.dex` (i.e. `sodax.dex.clService.*` and `sodax.dex.assetService.*`). The `Sodax` facade exposes only `dex`.
- **Skipping `assetService.deposit` before opening a position.** LP positions reference hub-asset addresses; without deposit there's nothing to provide.
- **Confusing pool addresses on Sonic with spoke token addresses.** CL pools live on Sonic; the user-facing tokens live on spokes.

## Migration workflow (v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md).
2. [`../migration-v1-to-v2/knowledge/features/dex.md`](../migration-v1-to-v2/knowledge/features/dex.md) — v1 `ConcentratedLiquidityError` / `AssetServiceError` → v2 `SodaxError<C>` with the appropriate `feature` tag.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Every `await sodax.dex.clService.<method>(...)` and `await sodax.dex.assetService.<method>(...)` has `if (!result.ok)`.
3. No `instanceof ConcentratedLiquidityError` / `AssetServiceError`.

## Related granular skills (same family)

- [`../recovery/SKILL.md`](../recovery/SKILL.md) — `RecoveryService` for stuck hub-wallet LP assets.
- [`../backend-api/SKILL.md`](../backend-api/SKILL.md) — `BackendApiService` for position reads if surfaced there.

For multi-feature tasks, load the broad [`sodax-sdk` skill](../SKILL.md).
