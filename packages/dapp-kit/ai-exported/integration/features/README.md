# Features — `@sodax/dapp-kit` v2

Per-feature reference docs. Each file documents the hooks, params types, return types, and feature-specific gotchas — but doesn't include extended worked examples (those live in [`../recipes/`](../recipes/)).

| File | Hook count | What's covered |
|---|---|---|
| [`swap.md`](swap.md) | 8 | Cross-chain swaps via the intent solver: `useQuote`, `useSwap`, allowance/approve, status polling, limit orders. |
| [`money-market.md`](money-market.md) | 13 | Lending/borrowing on the cross-chain MM: `useSupply`, `useBorrow`, `useWithdraw`, `useRepay`, allowance/approve, reserves data hooks. |
| [`staking.md`](staking.md) | ~18 | SODA → xSODA staking: `useStake`, `useUnstake`, `useInstantUnstake`, `useClaim`, `useCancelUnstake`, allowance/approve, info/ratio reads. |
| [`bridge.md`](bridge.md) | 5 | Cross-chain token bridging: `useBridge`, allowance/approve, bridgeable amount/tokens. |
| [`dex.md`](dex.md) | ~13 | Concentrated liquidity DEX: assets in/out, liquidity supply/decrease, claim rewards, position info, pool reads, param builders. |
| [`migration.md`](migration.md) | 6 | Token migration: `useMigrateIcxToSoda`, `useRevertMigrateSodaToIcx`, `useMigratebnUSD`, `useMigrateBaln`, allowance/approve. |
| [`bitcoin.md`](bitcoin.md) | ~8 | Radfi (dapp-kit-unique): session, trading wallet, fund/withdraw, UTXOs. |
| [`auxiliary-services.md`](auxiliary-services.md) | ~30 | Partner fee claiming, recovery, backend queries (intent tracking, orderbook, MM data), shared utilities (xBalances, gas, trustlines). |

## Reference vs recipes

- **Files in this directory (`features/`)** are reference: hook tables, type signatures, return shapes, feature-specific gotchas. Read when you need to know "what's this hook's exact shape" or "what does this method return."
- **Files in [`../recipes/`](../recipes/)** are how-to: complete worked examples, end-to-end flows, opinionated patterns. Read when you want to copy-paste working code.

## Pair-completeness

Every file in this directory has a sibling in [`../../migration/features/`](../../migration/features/) with the same filename — the v1→v2 porting playbook for that feature. When you're deep in one, the other is one path-swap away.

## Cross-references

- [`../architecture.md`](../architecture.md) — design concepts that span every feature (hook shapes, queryKey conventions, `useSafeMutation`, `mutateAsyncSafe`, `unwrapResult`).
- [`../recipes/`](../recipes/) — copy-paste flows.
- [`../reference/hooks-index.md`](../reference/hooks-index.md) — full hook table at one glance.
