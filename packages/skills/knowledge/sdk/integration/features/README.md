# Features — `@sodax/sdk` v2

One file per feature service. Each file documents the v2 API surface, common call shapes, return types, and error codes you can expect.

| Feature | Service class | What it does |
|---|---|---|
| [`swap.md`](swap.md) | `SwapService` | Intent-based swaps via the solver. Market and limit orders. Cross-chain by default. |
| [`money-market.md`](money-market.md) | `MoneyMarketService` | Cross-chain lending/borrowing. Supply, borrow, withdraw, repay. Reserves and user-position reads. |
| [`staking.md`](staking.md) | `StakingService` | SODA → xSoda staking via ERC-4626 vault. Stake, unstake (with penalty curve), instant unstake (slippage), claim, cancel. |
| [`bridge.md`](bridge.md) | `BridgeService` | Cross-chain token transfer via vault. `bridge` returns `TxHashPair = { srcChainTxHash, dstChainTxHash }`. Bridgeable-amount queries respect vault deposit limits. |
| [`dex.md`](dex.md) | `ClService` + `AssetService` | Uniswap-V3-style concentrated liquidity positions. Asset deposit/withdraw. Increase/decrease/claim flows. |
| [`icx-bnusd-baln.md`](icx-bnusd-baln.md) | `MigrationService` (the SDK module — not v1→v2 porting) | Legacy ICON ecosystem token migration. ICX ↔ SODA, legacy bnUSD ↔ new bnUSD, BALN → SODA with lockup multipliers. |
| [`auxiliary-services.md`](auxiliary-services.md) | `PartnerService` + `RecoveryService` + `BackendApiService` | Three small APIs grouped together: partner-fee claiming, hub-wallet asset recovery, backend HTTP client. |

All feature services are constructed and wired by the `Sodax` facade. You don't instantiate them directly — access them via `sodax.swaps`, `sodax.moneyMarket`, etc. See [`../architecture.md`](../architecture.md) for the service graph.

## Cross-references to migration

For the v1 → v2 port playbook on each feature, see the matching file in [`../../migration/features/`](../../migration/features/) — same filename, different angle.
