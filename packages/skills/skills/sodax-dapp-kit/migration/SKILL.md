---
name: sodax-dapp-kit-migration
description: 'Granular skill for the @sodax/dapp-kit v2 token-migration feature only — React Query hooks for migrating legacy ICON-ecosystem tokens to SODAX assets: useMigrateIcxToSoda, useRevertMigrateSodaToIcx, useMigratebnUSD (bidirectional), useMigrateBaln (with lockup), useMigrationApprove/useMigrationAllowance (action-discriminated). Use when a React dapp task is migrating legacy tokens (e.g. "useMigrateIcxToSoda", "migrate bnUSD hook in React", "migrate BALN with lock period hook", "revert SODA to ICX hook"). IMPORTANT — this is the token-protocol migration FEATURE, NOT v1 → v2 SDK code porting (that is the sodax-dapp-kit skill in migration mode). Same word, different concept. Covers BOTH integration (new v2 hooks) and the v1 → v2 port of these migration hooks. Links into the parent sodax-dapp-kit knowledge tree. For backend/Node, use the sodax-sdk skill.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Token migration (dapp-kit granular skill)

Granular skill for the token-migration hooks of `@sodax/dapp-kit` v2 — ICX/wICX ↔ SODA, legacy bnUSD ↔ new bnUSD, BALN → SODA. queryKey/mutationKey first segment: `migrate`. React-only — backend uses `@sodax/sdk` directly.

> **Important disambiguation.** This skill is about the token-migration **hooks** (migrating legacy ICON tokens to SODAX assets). It is **NOT** about porting v1 dapp-kit code to v2 — that lives under the broad `sodax-dapp-kit` skill (migration mode) and the [`../migration-v1-to-v2/knowledge/`](../migration-v1-to-v2/knowledge/) subtree. Same word, different concept.

## Step 0 — Confirm this IS a token-protocol migration

If the user means *"move/send/transfer a token from chain A to B"* → that's a **bridge** (vault-pair, [`../bridge/SKILL.md`](../bridge/SKILL.md)) or a **swap** (solver-routed, [`../swap/SKILL.md`](../swap/SKILL.md)). If they mean *"migrate my v1 dapp-kit code to v2"* → that's the SDK port; load the broad `sodax-dapp-kit` skill in migration mode. Only continue here for legacy ICON-ecosystem token migration.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port (of these hooks)?**
2. **Which token?** ICX/wICX → SODA (`useMigrateIcxToSoda`), SODA → wICX revert (`useRevertMigrateSodaToIcx`), legacy bnUSD ↔ new bnUSD (`useMigratebnUSD`, bidirectional), BALN → SODA (`useMigrateBaln`).
3. **For BALN: lockup period?** `lockupPeriod` is the `LockupPeriod` enum (values in SECONDS, not months); multiplier ranges 0.5x → 1.5x. `stake: boolean` is REQUIRED.
4. **Allowance gating?** ICON-side migrations need none; Sonic-side (revert) and EVM bnUSD do — use `useMigrationAllowance` + `useMigrationApprove` with `action: 'migrate' | 'revert'`.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — hook shapes, `mutateAsyncSafe`, `unwrapResult`, queryKey conventions.
3. [`../integration/knowledge/features/migration.md`](../integration/knowledge/features/migration.md) — full hook surface, per-action param types, the `LockupPeriod` enum, action-discriminated approve/allowance.
4. [`../integration/knowledge/recipes/migration.md`](../integration/knowledge/recipes/migration.md) — full worked examples.
5. Call-shape choice → [`../integration/knowledge/recipes/mutation-error-handling.md`](../integration/knowledge/recipes/mutation-error-handling.md).

### Token-migration-specific anti-patterns (dapp-kit)

- **Passing a literal number for BALN `lockupPeriod`.** Use the `LockupPeriod` enum members; values are seconds, not months. `BalnMigrateParams` also requires `stake: boolean`.
- **Looking for a second bnUSD hook for the reverse direction.** `useMigratebnUSD` is bidirectional — swap `srcbnUSD`/`dstbnUSD` + chains for the other direction.
- **Skipping approval on revert / EVM bnUSD.** `useRevertMigrateSodaToIcx` needs SODA approval on Sonic; gate with `useMigrationAllowance` + `useMigrationApprove({ action: 'revert' })`.
- **Conflating this feature with the SDK v1 → v2 port.** Different concerns; reading one playbook for the other produces broken code.

## Migration workflow (port v1 migration hooks to v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. Cross-cutting deltas: [`../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md`](../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md), [`../migration-v1-to-v2/knowledge/breaking-changes/result-handling.md`](../migration-v1-to-v2/knowledge/breaking-changes/result-handling.md), [`../migration-v1-to-v2/knowledge/breaking-changes/sdk-leakage.md`](../migration-v1-to-v2/knowledge/breaking-changes/sdk-leakage.md).
3. [`../migration-v1-to-v2/knowledge/features/migration.md`](../migration-v1-to-v2/knowledge/features/migration.md) — **biggest change**: v1's single `useMigrate(spokeProvider)`-style hook split into the per-action hooks above. The legacy `useMigrate` is in [`../migration-v1-to-v2/knowledge/reference/deleted-hooks.md`](../migration-v1-to-v2/knowledge/reference/deleted-hooks.md).

## Verification

1. `pnpm tsc --noEmit` clean.
2. BALN flows pass a `LockupPeriod` enum member and `stake: boolean`.
3. Revert / EVM-bnUSD flows gate on `useMigrationAllowance` + `useMigrationApprove`.
4. No legacy `useMigrate`, no `useSpokeProvider` (migration only).

## Related granular skills (same family)

- [`../staking/SKILL.md`](../staking/SKILL.md) — BALN migration can auto-stake into xSODA (`stake: true`); generic SODA staking lives there.
- [`../bridge/SKILL.md`](../bridge/SKILL.md), [`../swap/SKILL.md`](../swap/SKILL.md) — for "move a token across chains" (not a token-protocol migration).

For multi-feature tasks, load the broad [`sodax-dapp-kit` skill](../SKILL.md).

## Wallet connectivity (different SDK package family)

`walletProvider` flows through `mutate(vars)`. **Also load the `sodax-wallet-sdk-react` skill (integration mode)** to wire wallets (incl. ICON for ICX/BALN) and get a typed `walletProvider` via `useWalletProvider({ xChainId: chainKey })`.
