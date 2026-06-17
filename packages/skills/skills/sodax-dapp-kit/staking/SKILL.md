---
name: sodax-dapp-kit-staking
description: 'Granular skill for the @sodax/dapp-kit v2 staking feature only — React Query hooks for SODA ↔ xSODA staking: useStake, useUnstake, useInstantUnstake, useClaim, useCancelUnstake, the three dedicated approve/allowance hook pairs (stake/unstake/instantUnstake), plus reads (useStakingInfo, useUnstakingInfoWithPenalty, useStakingConfig, useStakeRatio). Use when a React dapp task is specifically staking (e.g. "useStake with dapp-kit", "unstake hook with penalty", "claim staking rewards in React", "instant unstake slippage hook", "render staking info"). Covers BOTH integration (new v2 hooks) and migration (port v1 staking hooks — single-object params, useStakeRatio now returns a tuple, mutateAsyncSafe). Links into the parent sodax-dapp-kit knowledge tree. For backend/Node, use the sodax-sdk skill.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Staking (dapp-kit granular skill)

Granular skill for the staking hooks of `@sodax/dapp-kit` v2. queryKey/mutationKey first segment: `staking`. React-only — backend uses `@sodax/sdk` directly.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?**
2. **Which action?** `useStake`, `useUnstake` (waiting period), `useInstantUnstake` (slippage, no wait), `useClaim`, `useCancelUnstake`.
3. **Allowance gating?** `stake` approves SODA, `unstake`/`instantUnstake` approve xSODA — each has its OWN approve + allowance hook pair. `claim`/`cancelUnstake` need no approval.
4. **Need reads?** `useStakingInfo` (position), `useUnstakingInfoWithPenalty` (pending requests + penalty), `useStakingConfig` (protocol params), `useStakeRatio`/`useInstantUnstakeRatio` (previews).

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — hook shapes, `mutateAsyncSafe`, `unwrapResult`, queryKey conventions.
3. [`../integration/knowledge/features/staking.md`](../integration/knowledge/features/staking.md) — full hook surface, mutation TVars per action, the three approve/allowance pairs, read shapes.
4. [`../integration/knowledge/recipes/staking.md`](../integration/knowledge/recipes/staking.md) — full worked examples.
5. Call-shape choice → [`../integration/knowledge/recipes/mutation-error-handling.md`](../integration/knowledge/recipes/mutation-error-handling.md).

### Staking-specific anti-patterns (dapp-kit)

- **Treating `useStakeRatio` `data` as a single bigint.** It's a 2-tuple `[xSodaAmount, previewDepositAmount]` (already unwrapped) — index `data?.[0]` / `data?.[1]`.
- **Branching on `data.ok` for staking reads.** All staking read hooks are already unwrapped (the hook throws on SDK `!ok`). Read `data` fields directly; surface SDK failures via `isError`/`error`.
- **Reading the request id at `req.request.requestId`.** On `useUnstakingInfoWithPenalty`, access `data?.requestsWithPenalty` directly; the id is `req.id`.
- **One global approve hook.** There are three — `useStakeApprove` (SODA), `useUnstakeApprove` (xSODA), `useInstantUnstakeApprove` (xSODA). Pick the one matching the action.
- **Treating instant unstake as free.** It bypasses the wait but pays slippage — preview with `useInstantUnstakeRatio`, set `minAmount`.

## Migration workflow (port v1 staking hooks to v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. Cross-cutting deltas: [`../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md`](../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md), [`../migration-v1-to-v2/knowledge/breaking-changes/result-handling.md`](../migration-v1-to-v2/knowledge/breaking-changes/result-handling.md), [`../migration-v1-to-v2/knowledge/breaking-changes/sdk-leakage.md`](../migration-v1-to-v2/knowledge/breaking-changes/sdk-leakage.md).
3. [`../migration-v1-to-v2/knowledge/features/staking.md`](../migration-v1-to-v2/knowledge/features/staking.md) — all five mutations + their dedicated approve hooks; `useStakeRatio` now returns a tuple.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Mutation flows use `mutateAsyncSafe` and branch on `result.ok`.
3. `useStakeRatio` consumers index the tuple (`data?.[0]`), not a scalar.
4. Staking reads read `data` directly (no `.ok`/`.value`).
5. No `useSpokeProvider`, no hook-level `spokeProvider` (migration only).

## Related granular skills (same family)

- [`../migration/SKILL.md`](../migration/SKILL.md) — BALN → SODA migration can auto-stake (`stake: true`); use it for BALN lock flows.
- [`../auxiliary-services/SKILL.md`](../auxiliary-services/SKILL.md) — `useXBalances` / gas-estimation utilities used alongside staking UI.

For multi-feature tasks, load the broad [`sodax-dapp-kit` skill](../SKILL.md).

## Wallet connectivity (different SDK package family)

`walletProvider` flows through `mutate(vars)`. **Also load the `sodax-wallet-sdk-react` skill (integration mode)** to wire wallets and get a typed `walletProvider` via `useWalletProvider({ xChainId: chainKey })`.
