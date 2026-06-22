---
name: sodax-sdk-migration
description: 'Granular skill for the @sodax/sdk v2 token-migration feature only — `MigrationService` (`sodax.migration`) covering ICX ↔ SODA, legacy bnUSD ↔ new bnUSD, and BALN → SODA with lockup multipliers. Use when the task is migrating legacy ICON-ecosystem tokens to SODAX (e.g. "migrate ICX to SODA", "revert SODA back to ICX", "swap legacy bnUSD on Sui/Stellar/ICON to new bnUSD", "migrate BALN with lock period for reward multiplier", "claim staked BALN"). IMPORTANT — this is NOT the same as v1 → v2 SDK migration (porting old SDK code). That is a separate cross-cutting concern handled by the broad sodax-sdk skill in migration mode and the migration-v1-to-v2/ knowledge subtree. Same word, different concept. Skill links into the parent sodax-sdk knowledge tree.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Token migration (Core SDK granular skill)

Granular skill for `MigrationService` — the SDK module that migrates legacy ICON-ecosystem tokens. Access via `sodax.migration` (with sub-services `sodax.migration.icxMigration`, `sodax.migration.bnUSDMigrationService`, `sodax.migration.balnSwapService`). Feature tag: `'migration'`.

> **Important disambiguation.** This skill is about the `MigrationService` SDK module. It is **NOT** about porting v1 SDK code to v2 — that lives under the broad `sodax-sdk` skill (migration mode) and the [`../migration-v1-to-v2/knowledge/`](../migration-v1-to-v2/knowledge/) subtree of this package. Same word, different concept.

## Step 0 — Confirm this IS a token-protocol migration

The word "migrate" is overloaded. This skill only handles **legacy ICON-ecosystem token swaps to SODAX assets** (ICX → SODA, legacy bnUSD → new bnUSD, BALN → SODA). If the user phrases the task as:

- *"move / send / transfer SODA from chain A to chain B"* → that's a **bridge** (vault-pair) or a **swap** (solver-routed). Load `sodax-sdk-bridge` or `sodax-sdk-swap` instead.
- *"migrate my v1 SDK code to v2"* → that's the SDK port. Load the broad `sodax-sdk` skill in migration mode and the `migration-v1-to-v2/` knowledge subtree.

Only continue here if the task involves one of the three legacy-token sources below.

## Step 1 — Clarify with user before coding

1. **Which token are you migrating?**
   - **ICX / wICX** ↔ SODA → `sodax.migration.icxMigration`.
   - **Legacy bnUSD** (ICON / Sui / Stellar) ↔ **new bnUSD** (EVM chains) → `sodax.migration.bnUSDMigrationService`.
   - **BALN** → SODA with optional lockup (0–24 months, multiplier 0.5x–1.5x) → `sodax.migration.balnSwapService`.
2. **Forward** (legacy → new) **or revert** (new → legacy, ICX only)?
3. **For BALN: lock period?** No lock = baseline; longer lock = higher reward multiplier.
4. **Signed or unsigned-tx flow?**
5. **Need orchestrated full flow** (`migrateXxx`) **or just intent creation** (`createMigrateXxxIntent`)?

## Integration workflow

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md).
2. [`../integration/knowledge/features/migration.md`](../integration/knowledge/features/migration.md) — `MigrationService` API surface and the three sub-services.
3. Path-specific recipe:
   - Signed → [`../integration/knowledge/recipes/signed-tx-flow.md`](../integration/knowledge/recipes/signed-tx-flow.md)
   - Unsigned → [`../integration/knowledge/recipes/raw-tx-flow.md`](../integration/knowledge/recipes/raw-tx-flow.md)
4. Errors (`feature: 'migration'`) → [`../integration/knowledge/reference/error-codes.md`](../integration/knowledge/reference/error-codes.md).

### Token-migration-specific anti-patterns

- **Assuming `BalnSwapService.stake/unstake/claim/...` return `Result<T>`.** They still THROW — deliberate tech debt. Wrap them in `try/catch` until cleaned up.
- **Using `migration` (the SDK module) and `migration-v1-to-v2` (the SDK port) interchangeably.** Different concerns; reading one playbook for the other will produce broken code.
- **Skipping `getAvailableAmount` for partial ICX migrations.** Tells you how much SODA the user can claim from a partial migration.

## Migration workflow (v1 → v2 of the SDK itself)

If the user is porting v1 `MigrationService` code to v2:

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md).
2. [`../migration-v1-to-v2/knowledge/features/migration.md`](../migration-v1-to-v2/knowledge/features/migration.md) — v1 `MigrationError` → v2 `SodaxError<C>` with `feature: 'migration'`. Note the BALN lock-method carve-out (still throws).

## Verification

1. `pnpm tsc --noEmit` clean.
2. Every `await sodax.migration.<method>(...)` (orchestrators + intent creators) has `if (!result.ok)`.
3. BALN lock-method calls (`stake`, `unstake`, `claim`, `claimUnstaked`, `cancelUnstake`, `getDetailedUserLocks`) remain wrapped in `try/catch` — they do not return `Result<T>`.

## Related granular skills (same family)

- [`../staking/SKILL.md`](../staking/SKILL.md) — generic SODA staking (different from BALN lockup, which migrates BALN → SODA in one step).
- [`../recovery/SKILL.md`](../recovery/SKILL.md) — recovery for stuck migration assets on the hub.

For multi-feature tasks, load the broad [`sodax-sdk` skill](../SKILL.md).
