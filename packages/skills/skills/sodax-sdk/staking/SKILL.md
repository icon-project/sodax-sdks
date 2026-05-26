---
name: sodax-sdk-staking
description: 'Granular skill for the @sodax/sdk v2 staking feature only — SODA ↔ xSoda staking via ERC-4626 vault. Stake, unstake (with penalty curve), instant unstake (slippage), claim, cancel unstake. Use when the task is staking (e.g. "stake SODA", "unstake xSoda", "claim Sodax staking rewards", "instant unstake with penalty", "cancel pending unstake", "get staking info from spoke"). Covers BOTH integration and migration. Skill links into the parent sodax-sdk knowledge tree. For React dapps, prefer sodax-dapp-kit.'
---

# Staking (Core SDK granular skill)

Granular skill for `StakingService` — `sodax.staking`. Feature tag: `'staking'`.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?**
2. **Which operation?** `stake`, `unstake`, `instantUnstake` (penalty), `claim`, `cancelUnstake`.
3. **Cross-chain** (staking from a spoke chain) **or hub-side** (Sonic)? Staking from a spoke routes through the relay.
4. **Need user staking info?**
   - From a **spoke** address (most consumer code): `getStakingInfoFromSpoke(srcAddress, srcChainKey)` — resolves spoke → hub then reads.
   - From a **hub** address directly (already on Sonic): `getStakingInfo(hubAddress)`. Both are public reads on `StakingService`.

## Integration workflow

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md).
2. [`../integration/knowledge/features/staking.md`](../integration/knowledge/features/staking.md) — `StakingService` API, penalty curve, instant-unstake slippage, claim flow.
3. Path-specific recipe:
   - Signed → [`../integration/knowledge/recipes/signed-tx-flow.md`](../integration/knowledge/recipes/signed-tx-flow.md)
   - Unsigned → [`../integration/knowledge/recipes/raw-tx-flow.md`](../integration/knowledge/recipes/raw-tx-flow.md)
4. Errors (`feature: 'staking'`) → [`../integration/knowledge/reference/error-codes.md`](../integration/knowledge/reference/error-codes.md).

### Staking-specific anti-patterns

- **Passing a spoke address to `getStakingInfo`.** It expects a hub address. Use `getStakingInfoFromSpoke(srcAddress, srcChainKey)` if you only have the spoke address — it derives the hub wallet internally.
- **Forgetting allowance before `stake`.** Like other action services, requires `approve` + `isAllowanceValid` flow.

## Migration workflow (v1 → v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md).
2. [`../migration-v1-to-v2/knowledge/features/staking.md`](../migration-v1-to-v2/knowledge/features/staking.md) — v1 `StakingError` → v2 `SodaxError<C>` with `feature: 'staking'`. If v1 code passed a spoke address into `getStakingInfo`, switch to `getStakingInfoFromSpoke(srcAddress, srcChainKey)` instead (v2 added it as the spoke-side wrapper; the hub-side `getStakingInfo(hubAddress)` is still public).

## Verification

1. `pnpm tsc --noEmit` clean.
2. Every `await sodax.staking.<method>(...)` has `if (!result.ok)`.
3. `getStakingInfo` call sites pass a hub address (not a spoke address); spoke-side reads use `getStakingInfoFromSpoke`.

## Related granular skills (same family)

- [`../icx-bnusd-baln/SKILL.md`](../icx-bnusd-baln/SKILL.md) — BALN → SODA migration also stakes (lockup periods 0–24 months); use it for BALN-specific lock flows.
- [`../recovery/SKILL.md`](../recovery/SKILL.md) — recovery for stuck staking-related assets.

For multi-feature tasks, load the broad [`sodax-sdk` skill](../SKILL.md).
