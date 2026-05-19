# Integration — `@sodax/dapp-kit` v2

This tree documents v2 of the dapp-kit React hooks for **new consumers** building against it. If you're porting v1 code, start at [`../migration/README.md`](../migration/README.md) instead.

## Files in this tree

| File | What's in it |
|---|---|
| [`ai-rules.md`](ai-rules.md) | **Read first.** DO / DO NOT / workflow / stop-conditions for AI agents writing v2 dapp-kit code. |
| [`quickstart.md`](quickstart.md) | Install, wire providers, get a wallet provider, run your first mutation. |
| [`architecture.md`](architecture.md) | Every v2 design concept the hooks rest on: ReadHookParams / MutationHookParams, useSafeMutation, unwrapResult, queryKey conventions, mutateAsyncSafe semantics, createSodaxQueryClient. |
| [`features/swap.md`](features/swap.md) | Swap hooks: `useQuote`, `useSwap`, `useSwapAllowance`, `useSwapApprove`, limit orders, status polling. |
| [`features/money-market.md`](features/money-market.md) | Money market hooks: `useSupply`, `useBorrow`, `useWithdraw`, `useRepay`, allowance/approve, reserves data. |
| [`features/staking.md`](features/staking.md) | Staking hooks: `useStake`, `useUnstake`, `useInstantUnstake`, `useClaim`, `useCancelUnstake`, info/ratio reads. |
| [`features/bridge.md`](features/bridge.md) | Bridge hooks: `useBridge`, allowance/approve, bridgeable amount/tokens. |
| [`features/dex.md`](features/dex.md) | DEX hooks: deposit/withdraw, supply/decrease liquidity, claim rewards, position info, pools. |
| [`features/migration.md`](features/migration.md) | Migration hooks: ICX/bnUSD/BALN forward + reverse, allowance/approve. |
| [`features/bitcoin.md`](features/bitcoin.md) | Radfi hooks (dapp-kit-unique): session, trading wallet, fund/withdraw, UTXOs. |
| [`features/auxiliary-services.md`](features/auxiliary-services.md) | Partner, recovery, backend queries, shared (xBalances, gas estimation, trustlines). |
| [`recipes/`](recipes/) | Copy-paste patterns: setup, wallet connectivity, per-feature flows, mutation error handling, observability, invalidations. |
| [`reference/`](reference/) | Lookup tables: full hook index, queryKey conventions, public API surface, glossary. |

## Reading order for a new integrator

1. **[`ai-rules.md`](ai-rules.md)** — agent rules, before any code.
2. **[`quickstart.md`](quickstart.md)** — get providers wired and a button rendering.
3. **[`architecture.md`](architecture.md)** — understand `useSafeMutation` / `mutateAsyncSafe` / hook shapes before writing call sites.
4. **[`recipes/`](recipes/)** — pick the patterns you need (mutation error handling, observability, invalidations).
5. **[`features/<x>.md`](features/)** — read the file for the feature you're integrating (reference shape; pair with the matching recipe in `recipes/<x>.md` for working examples).
6. **[`reference/`](reference/)** — keep open while writing for table lookups.

## Cross-references to migration

If your project also has v1 dapp-kit call sites, port them first using:

- [`../migration/README.md`](../migration/README.md) — overview, reading order, and v1↔v2 glossary.
- [`../migration/checklist.md`](../migration/checklist.md) — top-down cross-cutting checklist.
- [`../migration/breaking-changes/`](../migration/breaking-changes/) — the four cross-cutting changes (hook-signatures, result-handling, queryKey-conventions, sdk-leakage).
- [`../migration/features/`](../migration/features/) — per-feature playbooks in lockstep with `integration/features/` here.

The naming rule: **every file in `integration/features/` has a sibling in `migration/features/` with the same filename.** When you're deep in one, the other is one path-swap away.

## Cross-references to the underlying SDK

`@sodax/dapp-kit` re-exports `@sodax/sdk` at the package root, so most types you'd reach for (`ChainKeys`, `SodaxConfig`, `CreateIntentParams`, `XToken`, `Result`, `SodaxError`) are available from `@sodax/dapp-kit` directly. The Core SDK has its own knowledge tree at [`@sodax/sdk` knowledge tree](https://github.com/icon-project/sodax-sdks/tree/main/packages/skills/knowledge/sdk/) (sibling under `@sodax/skills`). Useful for:

- The full SDK migration playbook for v1→v2 (chain-key terminology, `Result<T>` semantics, ConfigService) — referenced from [`../migration/breaking-changes/sdk-leakage.md`](../migration/breaking-changes/sdk-leakage.md).
- Architectural concepts that surface through hook signatures (`SodaxError<C>` vocabulary, `WalletProviderSlot<K, Raw>` discriminator semantics).
- Backend / Node.js usage patterns (where dapp-kit isn't applicable).
