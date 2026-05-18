# Migration features — `@sodax/dapp-kit` v1 → v2

Per-feature porting playbooks. Each file shows the v1 → v2 delta for one feature's hook surface, with concrete code diffs.

| File | What's covered |
|---|---|
| [`swap.md`](swap.md) | v1 `useSwap(spokeProvider)`-style call sites → v2 `mutate({ params, walletProvider })`. Approve return shape change. Result handling. |
| [`money-market.md`](money-market.md) | v1 supply/borrow/withdraw/repay → v2 same with `srcChainKey`/`srcAddress` required. Allowance auto-skip for borrow/withdraw. |
| [`staking.md`](staking.md) | All five mutations + their dedicated approve hooks. `useStakeRatio` returns a tuple in v2. |
| [`bridge.md`](bridge.md) | Field renames in `useBridge` params (`srcChainId` → `srcChainKey`, `recipient` → `dstAddress`). `useGetBridgeableAmount` shape change. |
| [`dex.md`](dex.md) | Two-step flow stayed the same; field renames + `srcChainKey` requirement. `useSupplyLiquidity` mint/increase routing. |
| [`migration.md`](migration.md) | **Biggest change**: v1's `useMigrate(spokeProvider)` → 6 per-action hooks. |
| [`bitcoin.md`](bitcoin.md) | Radfi flow shapes are mostly unchanged; provider/session lifecycle hooks tightened. |
| [`auxiliary-services.md`](auxiliary-services.md) | Partner / recovery / backend queries / shared utilities — small per-hook changes. |

## Pair-completeness

Every file in this directory has a sibling in [`../../integration/features/`](../../integration/features/) with the same filename — the v2 design context for that feature. When you're stuck in one, the other is one path-swap away.

## Cross-cutting prerequisites

Before reading a feature playbook, make sure you've already read the cross-cutting deltas:

- [`../breaking-changes/hook-signatures.md`](../breaking-changes/hook-signatures.md) — provider stack, hook init shapes, approve return.
- [`../breaking-changes/result-handling.md`](../breaking-changes/result-handling.md) — `Result<T>` semantic shift.
- [`../breaking-changes/sdk-leakage.md`](../breaking-changes/sdk-leakage.md) — `srcChainKey`/`srcAddress` required, chain-key terminology, etc.

The per-feature files below are about the *feature-specific* delta on top of those cross-cutting changes.

## Cross-references

- [`../README.md`](../README.md) — migration overview + glossary.
- [`../checklist.md`](../checklist.md) — top-down checklist.
- [`../ai-rules.md`](../ai-rules.md) — DO / DO NOT for the porting agent.
