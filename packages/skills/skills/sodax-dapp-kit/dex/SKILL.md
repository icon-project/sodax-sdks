---
name: sodax-dapp-kit-dex
description: 'Granular skill for the @sodax/dapp-kit v2 DEX feature only — React Query hooks for concentrated-liquidity LP plus asset deposit/withdraw: useDexDeposit, useDexWithdraw, useSupplyLiquidity, useDecreaseLiquidity, useClaimRewards, useDexApprove/useDexAllowance, the useCreate*Params builders, and reads (usePools, usePoolData, usePositionInfo, useLiquidityAmounts). Use when a React dapp task is concentrated-liquidity LP (e.g. "create LP position with dapp-kit", "useSupplyLiquidity hook", "increase/decrease liquidity in React", "claim LP fees hook", "deposit hub assets for LP"). Two-step flow: deposit assets → supply liquidity. Covers BOTH integration (new v2 hooks) and migration (port v1 dex hooks — field renames + srcChainKey, mint/increase routing). Links into the parent sodax-dapp-kit knowledge tree. For backend/Node, use the sodax-sdk skill.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# DEX (dapp-kit granular skill)

Granular skill for the concentrated-liquidity DEX hooks of `@sodax/dapp-kit` v2. queryKey/mutationKey first segment: `dex`. Two-step flow: `useDexDeposit` (spoke asset → hub ERC-4626 pool shares) then `useSupplyLiquidity` (shares → position). React-only — backend uses `@sodax/sdk` directly.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?**
2. **Which operation?** Asset deposit/withdraw (`useDexDeposit`/`useDexWithdraw`), supply liquidity (`useSupplyLiquidity` — mint-new OR increase-existing), decrease (`useDecreaseLiquidity`), claim fees (`useClaimRewards`).
3. **Does opening a position require a deposit first?** Yes — positions hold hub pool shares; deposit from a spoke before supplying liquidity. UI flows usually combine the two steps.
4. **Using the param builders?** `useCreate*Params` compute derived params (tick range, ERC-4626 conversions) client-side; spread their result into `mutate({ params: { ...result, srcChainKey, srcAddress }, walletProvider })`.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — hook shapes, `mutateAsyncSafe`, `unwrapResult`, queryKey conventions.
3. [`../integration/knowledge/features/dex.md`](../integration/knowledge/features/dex.md) — full hook surface, SDK param types, the FLAT-props param builders, position-lifecycle notes.
4. [`../integration/knowledge/recipes/dex.md`](../integration/knowledge/recipes/dex.md) — full worked examples.
5. Call-shape choice → [`../integration/knowledge/recipes/mutation-error-handling.md`](../integration/knowledge/recipes/mutation-error-handling.md).

### DEX-specific anti-patterns (dapp-kit)

- **Skipping `useDexDeposit` before `useSupplyLiquidity`.** Positions reference hub pool shares; without a deposit there's nothing to provide.
- **Wrapping param builders in `{ params }`.** `useCreate*Params` take a FLAT props object (not `{ params }`-wrapped) and return memoized derived params; you add `srcChainKey` + `srcAddress` at the mutation call site.
- **Treating ticks as prices.** `tickLower`/`tickUpper` are logarithmic indices — convert with Q96 math / SDK helpers.
- **Calling a separate hook for increase-existing.** `useSupplyLiquidity` fans out to mint-new vs increase based on `params.tokenId` + `isValidPosition`; `useCreateSupplyLiquidityParams` handles the routing.
- **`usePositionInfo` `tokenId` is `string | null`, not bigint.**
- **Expecting `usePools` to auto-refresh.** It's `staleTime: Infinity` (static config).

## Migration workflow (port v1 dex hooks to v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. Cross-cutting deltas: [`../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md`](../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md), [`../migration-v1-to-v2/knowledge/breaking-changes/result-handling.md`](../migration-v1-to-v2/knowledge/breaking-changes/result-handling.md), [`../migration-v1-to-v2/knowledge/breaking-changes/sdk-leakage.md`](../migration-v1-to-v2/knowledge/breaking-changes/sdk-leakage.md).
3. [`../migration-v1-to-v2/knowledge/features/dex.md`](../migration-v1-to-v2/knowledge/features/dex.md) — two-step flow unchanged; field renames + `srcChainKey` requirement; `useSupplyLiquidity` mint/increase routing.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Deposit precedes supply in combined flows.
3. Param-builder output is spread with `srcChainKey`/`srcAddress` added at the call site.
4. Mutation flows use `mutateAsyncSafe` and branch on `result.ok`.
5. No `useSpokeProvider`, no hook-level `spokeProvider` (migration only).

## Related granular skills (same family)

- [`../auxiliary-services/SKILL.md`](../auxiliary-services/SKILL.md) — recovery (`useWithdrawHubAsset`) for stuck hub LP assets; `useXBalances` / gas utilities.

For multi-feature tasks, load the broad [`sodax-dapp-kit` skill](../SKILL.md).

## Wallet connectivity (different SDK package family)

`walletProvider` flows through `mutate(vars)`. **Also load the `sodax-wallet-sdk-react` skill (integration mode)** to wire wallets and get a typed `walletProvider` via `useWalletProvider({ xChainId: chainKey })`.
