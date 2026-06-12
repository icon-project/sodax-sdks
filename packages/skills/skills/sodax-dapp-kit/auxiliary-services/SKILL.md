---
name: sodax-dapp-kit-auxiliary-services
description: 'Granular skill for the @sodax/dapp-kit v2 auxiliary surfaces — partner fee claiming (useFeeClaimSwap, useApproveToken, useSetSwapPreference, useGetAutoSwapPreferences, useIsTokenApproved), recovery (useHubAssetBalances, useWithdrawHubAsset), read-only backend queries (useBackendIntentByTxHash, useBackendUserIntents, useBackendOrderbook, useBackendMoneyMarketPosition), the Swaps API v2 client hooks (useSwapsApiQuote, useSwapsApiSubmitTx, useSwapsApiStatus), and shared utilities (useSodaxContext, useHubProvider, useXBalances, useDeriveUserWalletAddress, useEstimateGas, useStellarTrustlineCheck, useRequestTrustline). Use when a React dapp task is partner fees, recovering stuck hub assets, backend data reads (intent tracking / orderbook / MM data, no wallet), or cross-cutting utilities (token balances, gas estimation, Stellar trustlines). Covers BOTH integration and migration. Links into the parent sodax-dapp-kit knowledge tree.'
---

# Auxiliary services (dapp-kit granular skill)

Granular skill for the smaller `@sodax/dapp-kit` v2 surfaces grouped together: **partner** (queryKey `partner`), **recovery** (`recovery`), **backend queries** (`backend`, read-only — no wallet), and **shared utilities** (`shared`). React-only — backend/Node uses `@sodax/sdk` directly.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?**
2. **Which surface?**
   - **Partner fees:** `useIsTokenApproved` → `useApproveToken` → `useSetSwapPreference` → `useFeeClaimSwap` (returns `IntentAutoSwapResult`, NOT `SwapResponse`); `useGetAutoSwapPreferences`, `useFetchAssetsBalances` for reads.
   - **Recovery:** `useHubAssetBalances` (list stuck hub assets) → `useWithdrawHubAsset` (withdraw one back to a spoke). Follows a *known* failed cross-chain op — investigate the failure first.
   - **Backend reads (no wallet):** intent tracking (`useBackendIntentByTxHash` polls 1s, `useBackendIntentByHash`, `useBackendUserIntents`), orderbook (`useBackendOrderbook` — `pagination` nests under `params`), MM data (`useBackendMoneyMarketPosition` etc.), and the Swaps API v2 client (`useSwapsApi*` — e.g. `useSwapsApiSubmitTx`, `useSwapsApiSubmitTxStatus`, `useSwapsApiQuote`).
   - **Shared utilities:** `useSodaxContext`, `useHubProvider`, `useXBalances` (needs `xService` from wallet-sdk-react), `useDeriveUserWalletAddress` / `useGetUserHubWalletAddress`, `useEstimateGas`, `useStellarTrustlineCheck` / `useRequestTrustline`.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — hook shapes, `mutateAsyncSafe`, `unwrapResult`, queryKey conventions.
3. [`../integration/knowledge/features/auxiliary-services.md`](../integration/knowledge/features/auxiliary-services.md) — full hook surface for all four surfaces, `useXBalances` shape, trustline pattern, default polling intervals.
4. Worked examples:
   - Backend reads → [`../integration/knowledge/recipes/backend-queries.md`](../integration/knowledge/recipes/backend-queries.md).
   - `useXBalances` → [`../integration/knowledge/recipes/wallet-connectivity.md`](../integration/knowledge/recipes/wallet-connectivity.md).
5. Call-shape choice → [`../integration/knowledge/recipes/mutation-error-handling.md`](../integration/knowledge/recipes/mutation-error-handling.md).

### Auxiliary-specific anti-patterns (dapp-kit)

- **Treating `useFeeClaimSwap` `data` as a `SwapResponse`.** It's `IntentAutoSwapResult`.
- **Passing top-level `pagination` to `useBackendOrderbook` / `useBackendAllMoneyMarketBorrowers`.** It nests under `params`; without it those queries are disabled.
- **Calling `useXBalances` without `xService`.** Supply `xService` from `@sodax/wallet-sdk-react`'s `useXService`; the request-side key is `xChainId` (the cross-chain abstraction), distinct from the token-side `chainKey`.
- **Treating `useRequestTrustline` as a canonical mutation hook.** It takes a single positional `token` arg and returns `{ requestTrustline, isLoading, ... }`; the callback takes `{ token, amount, srcChainKey, walletProvider }` (NOT `account`/`asset`).
- **Running recovery on successful flows.** Recovery is a workaround for *failed* ops — `useHubAssetBalances` first, then withdraw the specific entry; investigate the original failure.
- **Leaving `useBackendIntentByTxHash` polling (1s) running after the intent resolves.**

## Migration workflow (port v1 auxiliary hooks to v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. Cross-cutting deltas: [`../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md`](../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md), [`../migration-v1-to-v2/knowledge/breaking-changes/result-handling.md`](../migration-v1-to-v2/knowledge/breaking-changes/result-handling.md), [`../migration-v1-to-v2/knowledge/breaking-changes/sdk-leakage.md`](../migration-v1-to-v2/knowledge/breaking-changes/sdk-leakage.md).
3. [`../migration-v1-to-v2/knowledge/features/auxiliary-services.md`](../migration-v1-to-v2/knowledge/features/auxiliary-services.md) — small per-hook changes across partner / recovery / backend / shared.

## Verification

1. `pnpm tsc --noEmit` clean.
2. `useBackendOrderbook` / paginated MM reads nest `pagination` under `params`.
3. `useXBalances` is supplied an `xService`.
4. Mutation flows (partner / recovery / submit) use `mutateAsyncSafe` and branch on `result.ok`.
5. No `useSpokeProvider`, no hook-level `spokeProvider` (migration only).

## Related granular skills (same family)

- [`../swap/SKILL.md`](../swap/SKILL.md) — `useSwapsApiSubmitTx` + intent tracking are the backend half of the step-by-step swap flow; partner fee-claim reuses the swap intent layer.
- [`../money-market/SKILL.md`](../money-market/SKILL.md) — backend MM reads complement the on-chain MM action hooks.

For multi-feature tasks, load the broad [`sodax-dapp-kit` skill](../SKILL.md).

## Wallet connectivity (different SDK package family)

Partner/recovery mutations take a `walletProvider`; `useXBalances` needs an `xService`. **Also load the `sodax-wallet-sdk-react` skill (integration mode)** for `useWalletProvider` and `useXService`. (Backend read hooks need no wallet.)
