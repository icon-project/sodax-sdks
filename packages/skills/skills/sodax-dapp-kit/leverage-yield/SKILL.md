---
name: sodax-dapp-kit-leverage-yield
description: 'Granular skill for the @sodax/dapp-kit v2 leverage-yield feature only — React Query hooks for leveraged-yield ERC-4626 vaults on Sonic: useLeverageYieldDeposit and useLeverageYieldWithdraw (build a swap payload), useLeverageYieldVaultSwap (execute it end-to-end), plus reads useLeverageYieldEffectiveApr, useLeverageYieldPosition, useLeverageYieldTotalAssets, useLeverageYieldPreviewRedeem, useLeverageYieldShareBalances. Use when a React dapp task is leverage-yield vaults (e.g. "deposit into a leverage vault with dapp-kit", "useLeverageYieldVaultSwap hook", "render vault APR / position / TVL", "lsoda share balances across chains", "withdraw from leverage vault"). New in v2 — integration only, no v1 migration path. Links into the parent sodax-dapp-kit knowledge tree. For backend/Node, use the sodax-sdk skill.'
---

# Leverage Yield (dapp-kit granular skill)

Granular skill for the leverage-yield hooks of `@sodax/dapp-kit` v2. queryKey/mutationKey first segment: `leverageYield`. React-only — backend uses `@sodax/sdk` directly. **New in v2; no v1 migration path.**

## Step 1 — Clarify with user before coding

1. **Deposit or withdraw?** Deposit = any token → `lsoda*` shares (lands in the hub wallet). Withdraw = `lsoda*` shares → any token on any chain.
2. **Build vs execute.** `useLeverageYieldDeposit` / `useLeverageYieldWithdraw` only *build* a `LeverageYieldSwapPayload`; `useLeverageYieldVaultSwap` *executes* it (create → relay → notify solver). You always need both.
3. **Approval?** Deposit approves the spoke `inputToken` via the swap-domain `useSwapApprove` / `useSwapAllowance` (no leverage-yield-specific approve hook). Withdraw needs no approval (`hubWalletSwap: true`).
4. **Which reads?** `useLeverageYieldEffectiveApr` (headline APR), `useLeverageYieldPosition` (LTV/health), `useLeverageYieldTotalAssets` (TVL), `useLeverageYieldPreviewRedeem` (price-per-share), `useLeverageYieldShareBalances` (per-chain balances — returns an array).

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — hook shapes, `mutateAsyncSafe`, `unwrapResult`, queryKey conventions.
3. [`../integration/knowledge/features/leverage-yield.md`](../integration/knowledge/features/leverage-yield.md) — full hook surface, mutation TVars, read shapes, approval pattern, gotchas.
4. [`../integration/knowledge/recipes/leverage-yield.md`](../integration/knowledge/recipes/leverage-yield.md) — full worked examples (deposit, withdraw, stats, share balances).
5. Call-shape choice → [`../integration/knowledge/recipes/mutation-error-handling.md`](../integration/knowledge/recipes/mutation-error-handling.md).

### Leverage-yield-specific anti-patterns (dapp-kit)

- **Calling `useLeverageYieldDeposit` / `useLeverageYieldWithdraw` and expecting a tx.** They are builders — their `data` is a `LeverageYieldSwapPayload`. Spread it into `useLeverageYieldVaultSwap`'s `mutate` with a `walletProvider` to broadcast.
- **Treating `useLeverageYieldShareBalances` as a single query.** It returns an **array** (one `useQueries` row per holder). Aggregate with `reduce`; the key segment is singular `shareBalance`.
- **Gating withdraw on an allowance check.** Withdraw carries `hubWalletSwap: true` — the hub wallet authorises the share spend via `sendMessage`. Only `deposit` uses `useSwapAllowance` / `useSwapApprove`.
- **Reaching for a `useLeverageYieldApprove` hook.** It doesn't exist — the deposit approves the spoke asset manager, so use the swap-domain hooks.
- **Quoting on the pre-fee amount.** A deposit's per-intent `partnerFee` is deducted from `inputAmount` before the swap — quote on the post-fee amount or `minOutputAmount` is unfillable.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Deposit/withdraw build a payload, then `useLeverageYieldVaultSwap` executes it (`{ ...payload, walletProvider }`).
3. `useLeverageYieldShareBalances` consumers treat `data` as an array and aggregate.
4. Withdraw flows do not gate on `useSwapAllowance`.
5. Mutation flows use `mutateAsyncSafe` and branch on `result.ok`; reads read `data` directly (no `.ok`/`.value`).

## Related granular skills (same family)

- [`../swap/SKILL.md`](../swap/SKILL.md) — `useSwapApprove` / `useSwapAllowance` (spoke-side deposit approval) and `useQuote` (size `minOutputAmount`) live here.
- [`../auxiliary-services/SKILL.md`](../auxiliary-services/SKILL.md) — `useXBalances` / gas-estimation utilities used alongside leverage-yield UI.

For multi-feature tasks, load the broad [`sodax-dapp-kit` skill](../SKILL.md).

## Wallet connectivity (different SDK package family)

`walletProvider` flows through `mutate(vars)`. **Also load the `sodax-wallet-sdk-react` skill (integration mode)** to wire wallets and get a typed `walletProvider` via `useWalletProvider({ xChainId: chainKey })`.
