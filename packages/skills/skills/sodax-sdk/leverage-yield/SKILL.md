---
name: sodax-sdk-leverage-yield
description: 'Granular skill for the @sodax/sdk v2 leverage-yield feature only — leveraged-yield ERC-4626 vaults on Sonic via LeverageYieldService. Deposit any token → lsoda* shares, withdraw shares → any token (both as solver-tradeable intent swaps), createVaultIntent/vaultSwap/notifySolver, Sonic-direct approve/isAllowanceValid, and reads (getApr, getEffectiveApr, getPosition, getTotalAssets, preview*, getMaxWithdraw*, getShareBalance*, listVaults). Use when the task is leverage-yield vaults (e.g. "deposit into a leverage vault", "withdraw lsoda shares", "vault APR / effective APR", "leverage vault position / health factor", "lsoda share balance"). New in v2 — integration only, no v1 migration path. Links into the parent sodax-sdk knowledge tree. For React dapps, prefer sodax-dapp-kit.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Leverage Yield (Core SDK granular skill)

Granular skill for `LeverageYieldService` — `sodax.leverageYield`. Feature tag: `'leverageYield'`. **New in v2; no v1 migration path.**

## Step 1 — Clarify with user before coding

1. **Deposit or withdraw?** Deposit = any spoke token → `lsoda*` shares (delivered to the user's hub wallet). Withdraw = `lsoda*` shares (in the hub wallet) → any token on any chain.
2. **Build vs execute.** `deposit` / `withdraw` only *build* a `LeverageYieldSwapPayload`; `vaultSwap` *executes* it end-to-end. Spread the built payload into `vaultSwap({ ...payload, walletProvider })`.
3. **End-to-end or manual relay?** `vaultSwap` does create → verify → relay → notify. For backend submit-tx, use `createVaultIntent` then relay yourself and finish with the public `notifySolver`.
4. **Reads?** `getEffectiveApr` (headline, AAVE + LSD), `getApr` (AAVE-only — can be negative), `getPosition`, `getTotalAssets`, `previewRedeem`, `getMaxWithdrawForUser` / `getShareBalanceForUser` (resolve the hub wallet from a spoke address internally).

## Integration workflow

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md).
2. [`../integration/knowledge/features/leverage-yield.md`](../integration/knowledge/features/leverage-yield.md) — `LeverageYieldService` API, the share-as-token model, deposit/withdraw/vaultSwap flows, APR math.
3. Path-specific recipe:
   - Signed → [`../integration/knowledge/recipes/signed-tx-flow.md`](../integration/knowledge/recipes/signed-tx-flow.md)
   - Unsigned → [`../integration/knowledge/recipes/raw-tx-flow.md`](../integration/knowledge/recipes/raw-tx-flow.md)
4. Errors (`feature: 'leverageYield'`) → [`../integration/knowledge/reference/error-codes.md`](../integration/knowledge/reference/error-codes.md).

### Leverage-yield-specific anti-patterns

- **Expecting `deposit` / `withdraw` to broadcast.** They are builders returning a `LeverageYieldSwapPayload`. Execute via `vaultSwap({ ...payload, walletProvider })`.
- **Using `getApr` as the headline number.** For LSD-backed vaults the AAVE-only spread is often negative; `getEffectiveApr` folds in the LSD staking yield (the real source of return).
- **Passing a spoke address to `getShareBalance` / `getMaxWithdraw`.** Those take a hub address. Use the `*ForUser(vault, srcChainKey, srcAddress)` variants to resolve the hub wallet first.
- **Gating withdraw on `approve` / `isAllowanceValid`.** Those are Sonic-direct allowance helpers for the vault's underlying asset; the swap-style withdraw authorises the share spend via a hub-wallet `Connection.sendMessage` (`hubWalletSwap: true`).
- **Quoting on the pre-fee amount.** A deposit's per-intent `partnerFee` is deducted from `inputAmount` before the swap — quote (via the swap solver, `token_dst` = vault) on the post-fee amount.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Every `await sodax.leverageYield.<method>(...)` has `if (!result.ok)`.
3. Deposit/withdraw build a payload that is then run through `vaultSwap` (or `createVaultIntent` + relay + `notifySolver`).
4. APR display uses `getEffectiveApr`; share/withdraw sizing from a spoke address uses the `*ForUser` reads.

## Related granular skills (same family)

- [`../swap/SKILL.md`](../swap/SKILL.md) — `vaultSwap` is a leverage-yield copy of the swap intent flow; quote `minOutputAmount` via the solver quote there.
- [`../recovery/SKILL.md`](../recovery/SKILL.md) — recover stuck hub-wallet assets (including `lsoda*` shares) back to a spoke chain.

For multi-feature tasks, load the broad [`sodax-sdk` skill](../SKILL.md).
