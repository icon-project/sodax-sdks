---
name: sodax-sdk-recovery
description: 'Granular skill for the @sodax/sdk v2 recovery feature only — `RecoveryService` for withdrawing stuck hub-wallet assets back to a spoke chain. Use when the task is recovering assets stranded on the hub after a failed cross-chain operation (e.g. "recover stuck assets on Sonic", "Sodax RecoveryService", "fetchHubAssetBalances", "withdrawHubAsset", "stuck-asset withdrawal"). Service is NEW in v2 (no v1 equivalent). Covers BOTH integration and the v2-only migration note. Skill links into the parent sodax-sdk knowledge tree.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Recovery (Core SDK granular skill)

Granular skill for `RecoveryService` — `sodax.recovery`. Feature tag for errors: `'recovery'`. Service is **new in v2** — no v1 equivalent.

## Step 1 — Clarify with user before coding

1. **What's the trigger?** Recovery should follow a *known* failed cross-chain operation. If the user can't name the failure, investigate the original op first.
2. **Which operation?**
   - `fetchHubAssetBalances` (read; list stuck hub assets for the user).
   - `withdrawHubAsset` (mutation; withdraw one entry back to a chosen spoke chain).
3. **Signed flow or unsigned-tx?** `withdrawHubAsset` follows the same `WalletProviderSlot<K, Raw>` pattern as other mutations.

## Integration workflow

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md).
2. [`../integration/knowledge/features/recovery.md`](../integration/knowledge/features/recovery.md) — `RecoveryService` API + when-to-use guidance.
3. Path-specific recipe:
   - Signed → [`../integration/knowledge/recipes/signed-tx-flow.md`](../integration/knowledge/recipes/signed-tx-flow.md)
   - Unsigned → [`../integration/knowledge/recipes/raw-tx-flow.md`](../integration/knowledge/recipes/raw-tx-flow.md)
4. Errors (`feature: 'recovery'`) → [`../integration/knowledge/reference/error-codes.md`](../integration/knowledge/reference/error-codes.md).

### Recovery-specific anti-patterns

- **Treating recovery as a routine flow.** It's a workaround for failures; calling it on successfully completed flows wastes gas and confuses users.
- **Skipping the balance read.** `fetchHubAssetBalances` returns the full set of hub assets for a user; pick the one to withdraw rather than guessing the address.
- **Ignoring the underlying failure.** Recovery moves the asset but doesn't explain why the original op failed — investigate first (relay timeout? bad params? destination chain issue?).

## Migration workflow (v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md).
2. [`../migration-v1-to-v2/knowledge/features/recovery.md`](../migration-v1-to-v2/knowledge/features/recovery.md) — service is new in v2; no port to do. If you have v1 workaround code that walked the hub wallet abstraction manually, replace it with `fetchHubAssetBalances` + `withdrawHubAsset`.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Every `await sodax.recovery.<method>(...)` has `if (!result.ok)`.
3. Any v1 ad-hoc "find stuck assets" workaround code is removed.

## Related granular skills (same family)

- [`../swap/SKILL.md`](../swap/SKILL.md), [`../bridge/SKILL.md`](../bridge/SKILL.md), [`../money-market/SKILL.md`](../money-market/SKILL.md), etc. — the upstream features whose failures may strand assets.
- [`../backend-api/SKILL.md`](../backend-api/SKILL.md) — intent / tx lookups to diagnose the original failure before recovering.

For multi-feature tasks, load the broad [`sodax-sdk` skill](../SKILL.md).
