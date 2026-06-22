---
name: sodax-dapp-kit-bitcoin
description: 'Granular skill for the @sodax/dapp-kit v2 Bitcoin/Radfi feature only — React Query hooks for Bitcoin trading via the Radfi protocol: useRadfiAuth, useRadfiSession, useTradingWallet, useFundTradingWallet, useRadfiWithdraw, useExpiredUtxos, useRenewUtxos, useBitcoinBalance, useTradingWalletBalance. This is a dapp-kit-UNIQUE surface (no @sodax/sdk equivalent — the flows are React-shaped). Use when a React dapp task is Bitcoin/Radfi (e.g. "Radfi session hook", "fund trading wallet hook", "Radfi withdraw in React", "manage Bitcoin UTXOs hook", "BIP322 auth with dapp-kit"). Covers BOTH integration (new v2 hooks) and migration (port v1 Radfi hooks — mostly signature tightening, flow unchanged). Links into the parent sodax-dapp-kit knowledge tree.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Bitcoin / Radfi (dapp-kit granular skill)

Granular skill for the Bitcoin trading hooks of `@sodax/dapp-kit` v2 — authenticate (BIP322), fund a trading wallet, withdraw, manage UTXOs via the Radfi protocol. queryKey/mutationKey first segment: `bitcoin`. **Dapp-kit-unique** — no `@sodax/sdk` equivalent.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?**
2. **Which stage?** Session/auth (`useRadfiAuth`, `useRadfiSession`, `useTradingWallet`), balances (`useBitcoinBalance`, `useTradingWalletBalance`), operations (`useFundTradingWallet`, `useRadfiWithdraw`), UTXO maintenance (`useExpiredUtxos`, `useRenewUtxos`).
3. **Session lifecycle handled?** `useRadfiSession(walletProvider)` manages login/refresh/auto-refresh + localStorage persistence; gate trading buttons on `isAuthed`.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — hook shapes, `mutateAsyncSafe`, `unwrapResult`, queryKey conventions.
3. [`../integration/knowledge/features/bitcoin.md`](../integration/knowledge/features/bitcoin.md) — full hook surface, session flow, mutation TVars, return shapes, polling notes.
4. [`../integration/knowledge/recipes/bitcoin.md`](../integration/knowledge/recipes/bitcoin.md) — full worked examples (session, fund, withdraw, UTXO management).
5. Call-shape choice → [`../integration/knowledge/recipes/mutation-error-handling.md`](../integration/knowledge/recipes/mutation-error-handling.md).

### Bitcoin/Radfi-specific anti-patterns (dapp-kit)

- **Calling trading operations before auth.** Gate on `useRadfiSession(...).isAuthed`; the trading wallet is created during first authentication, not as a separate step.
- **Expecting `useTradingWallet` to fetch.** It's synchronous — reads the persisted session from localStorage (keyed by wallet address). Use it when you don't yet have a `walletProvider`.
- **Hand-rolling PSBT signing for withdrawals.** `useRadfiWithdraw` orchestrates the unsigned-PSBT → local-sign → co-sign → broadcast flow; consumers don't touch PSBTs directly.
- **Treating `useRadfiAuth` `data` as a full `RadfiSession`.** It's `RadfiAuthResult = { accessToken, refreshToken, tradingAddress }` (no `publicKey` in the return; it's persisted internally).
- **Leaving `useExpiredUtxos` polling (60s) on hidden UI.** Set `queryOptions.refetchInterval: false` when not visible.

## Migration workflow (port v1 Radfi hooks to v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. Cross-cutting deltas: [`../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md`](../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md), [`../migration-v1-to-v2/knowledge/breaking-changes/result-handling.md`](../migration-v1-to-v2/knowledge/breaking-changes/result-handling.md).
3. [`../migration-v1-to-v2/knowledge/features/bitcoin.md`](../migration-v1-to-v2/knowledge/features/bitcoin.md) — Radfi flow is mostly unchanged; provider/session lifecycle hook signatures tightened.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Trading buttons gate on `isAuthed`.
3. Mutation flows use `mutateAsyncSafe` and branch on `result.ok`.
4. No hand-rolled PSBT signing; `useRadfiWithdraw` owns the flow.

## Related granular skills (same family)

- [`../auxiliary-services/SKILL.md`](../auxiliary-services/SKILL.md) — `useXBalances` and other shared utilities used alongside Bitcoin UI.

For multi-feature tasks, load the broad [`sodax-dapp-kit` skill](../SKILL.md).

## Wallet connectivity (different SDK package family)

These hooks take an `IBitcoinWalletProvider`. **Also load the `sodax-wallet-sdk-react` skill (integration mode)** to wire a Bitcoin wallet and obtain the provider via `useWalletProvider({ xChainId: ChainKeys.BITCOIN_MAINNET })`.
