---
name: sodax-sdk-partner
description: 'Granular skill for the @sodax/sdk v2 partner-fee feature only — `PartnerService` (operations on `sodax.partners.feeClaim`). Token approval on the hub, auto-swap preferences, immediate fee-claim swap, intent-driven auto-swap, asset-balance reads. Use when the task is partner-fee work (e.g. "claim partner fee", "configure partner auto-swap preference", "approve partner fee token on Sodax hub", "Sodax PartnerService"). Covers BOTH integration and migration. Skill links into the parent sodax-sdk knowledge tree. For React dapps, prefer sodax-dapp-kit.'
---

# Partner (Core SDK granular skill)

Granular skill for `PartnerService` — `sodax.partners`. Operations live on `sodax.partners.feeClaim` (the parent only exposes `feeClaim` and `config`). Feature tag for errors: `'partner'`.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?**
2. **Which operation?**
   - One-time setup: `isTokenApproved` → `approveToken` → `setSwapPreference`.
   - Recurring: `swap` (immediate) or `createIntentAutoSwap` (intent-driven auto-swap).
   - Reads: `getAutoSwapPreferences`, `fetchAssetsBalances`.
3. **Signed flow or unsigned-tx?**

## Integration workflow

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md).
2. [`../integration/knowledge/features/partner.md`](../integration/knowledge/features/partner.md) — `PartnerService` API, common call shape (approve → preference → swap).
3. Path-specific recipe:
   - Signed → [`../integration/knowledge/recipes/signed-tx-flow.md`](../integration/knowledge/recipes/signed-tx-flow.md)
   - Unsigned → [`../integration/knowledge/recipes/raw-tx-flow.md`](../integration/knowledge/recipes/raw-tx-flow.md)
4. Errors (`feature: 'partner'`) → [`../integration/knowledge/reference/error-codes.md`](../integration/knowledge/reference/error-codes.md).

### Partner-specific anti-patterns

- **Calling `sodax.partners.claimFees(...)`.** Method doesn't exist on `sodax.partners` directly — all fee-claim operations live on `sodax.partners.feeClaim`.
- **Skipping the `isTokenApproved` check before fee claim.** The partner's fee token must be approved on the hub once; subsequent claims reuse the allowance.
- **Forgetting to `setSwapPreference`.** Without an auto-swap preference, partner-collected fees stay in the original asset.

## Migration workflow (v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md).
2. [`../migration-v1-to-v2/knowledge/features/partner.md`](../migration-v1-to-v2/knowledge/features/partner.md) — drop `spokeProvider`, add `walletProvider`, `srcChainKey`, `srcAddress`. All 5 v1 typed errors collapse into `SodaxError<C>` with `feature: 'partner'`.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Every `await sodax.partners.feeClaim.<method>(...)` has `if (!result.ok)`.
3. No `instanceof PartnerFeeClaimError` (or the 4 sibling v1 error classes).

## Related granular skills (same family)

- [`../recovery/SKILL.md`](../recovery/SKILL.md) — partner-collected funds stuck on the hub.
- [`../backend-api/SKILL.md`](../backend-api/SKILL.md) — backend HTTP client for tracking partner-claim intents.
- [`../swap/SKILL.md`](../swap/SKILL.md) — partner-fee `swap` and `createIntentAutoSwap` reuse the swap intent layer.

For multi-feature tasks, load the broad [`sodax-sdk` skill](../SKILL.md).
