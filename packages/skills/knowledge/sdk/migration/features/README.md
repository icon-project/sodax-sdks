# Per-feature migration playbooks — v1 → v2

One file per feature, paired with the v2 design counterpart in [`../../integration/features/`](../../integration/features/) (same filename).

| Feature | Migration file |
|---|---|
| Swap | [`swap.md`](swap.md) |
| Money Market | [`money-market.md`](money-market.md) |
| Staking | [`staking.md`](staking.md) |
| Bridge | [`bridge.md`](bridge.md) |
| DEX | [`dex.md`](dex.md) |
| ICX/bnUSD/BALN | [`icx-bnusd-baln.md`](icx-bnusd-baln.md) |
| Auxiliary services | [`auxiliary-services.md`](auxiliary-services.md) — `PartnerService` + `RecoveryService` + `BackendApiService`. The backend-API one is the load-bearing change: every method now returns `Promise<Result<T>>`. |

## Reading order within a feature

Each per-feature file follows the same shape:

1. **TL;DR** — the load-bearing changes in 5–10 bullets.
2. **Type / symbol cheat sheet** — exact renames and shape diffs.
3. **Per-method delta** — call shape v1 vs v2, return type v1 vs v2, error model v1 vs v2.
4. **Worked example** — a representative migration of one call site, before / after.
5. **Pitfalls** — the things that look right but compile or run wrong.
6. **Verification** — what to run to confirm the port is complete.

## Cross-cutting prerequisites

Before reading any feature file, finish the cross-cutting work in:

- [`../README.md`](../README.md) — top-level checklist (chain-id rename, type renames, `walletProvider` extraction).
- [`../breaking-changes/type-system.md`](../breaking-changes/type-system.md) — type imports must compile first.
- [`../breaking-changes/architecture.md`](../breaking-changes/architecture.md) — `*SpokeProvider` deletion, `ConfigService`.
- [`../breaking-changes/result-and-errors.md`](../breaking-changes/result-and-errors.md) — `Result<T>` and `SodaxError<C>`.

Per-feature work assumes those are done.
