# Features — `@sodax/sdk` v2

One file per feature service. Each file documents the v2 API surface, common call shapes, return types, and error codes you can expect.

| Feature | Service class | What it does |
|---|---|---|
| [`swap.md`](swap.md) | `SwapService` | Intent-based swaps via the solver. Market and limit orders. Cross-chain by default. |
| [`money-market.md`](money-market.md) | `MoneyMarketService` | Cross-chain lending/borrowing. Supply, borrow, withdraw, repay. Reserves and user-position reads. |
| [`staking.md`](staking.md) | `StakingService` | SODA → xSoda staking via ERC-4626 vault. Stake, unstake (with penalty curve), instant unstake (slippage), claim, cancel. |
| [`bridge.md`](bridge.md) | `BridgeService` | Cross-chain token transfer via vault. `bridge` returns `TxHashPair = { srcChainTxHash, dstChainTxHash }`. Bridgeable-amount queries respect vault deposit limits. |
| [`dex.md`](dex.md) | `ClService` + `AssetService` | Uniswap-V3-style concentrated liquidity positions. Asset deposit/withdraw. Increase/decrease/claim flows. |
| [`leverage-yield.md`](leverage-yield.md) | `LeverageYieldService` | Leveraged-yield ERC-4626 vaults on Sonic. Deposit/withdraw as solver-tradeable `lsoda*` swaps; effective APR (AAVE + LSD), position, share-balance reads. |
| [`migration.md`](migration.md) | `MigrationService` (the SDK module — not v1→v2 porting) | Legacy ICON ecosystem token migration. ICX ↔ SODA, legacy bnUSD ↔ new bnUSD, BALN → SODA with lockup multipliers. |
| [`partner.md`](partner.md) | `PartnerService` | Partner-fee handling: token approval, auto-swap preferences, fee-claim flows. |
| [`recovery.md`](recovery.md) | `RecoveryService` | Withdraw stuck hub-wallet assets back to a spoke chain. |
| [`backend-api.md`](backend-api.md) | `BackendApiService` | HTTP client for backend services: swap-tx submission, intent / orderbook lookups, money-market reads. |
| [`swaps-api.md`](swaps-api.md) | `SwapsApiService` | Typed HTTP client for the backend Swaps API v2 (`sodax.api.swaps`): quote, deadline, allowance/approve, create-intent, intent lifecycle (submit/status/cancel/hash/packet/extra-data), limit orders, gas, fees, submit-tx + status. |
| [`leverage-yield-api.md`](leverage-yield-api.md) | `LeverageYieldApiService` | Typed HTTP client for the backend Leverage Yield API v2 (`sodax.api.leverageYield`): vault registry, vault reads (asset/position/APR/effective-APR/LSD-APR/total-assets/previews/share-balance/max-withdraw), deposit & withdraw quote, allowance/approve, create-deposit/withdraw-intent, intent lifecycle, gas, fees, submit-tx + status. |

All feature services are constructed and wired by the `Sodax` facade. You don't instantiate them directly — access them via `sodax.swaps`, `sodax.moneyMarket`, etc. See [`../architecture.md`](../architecture.md) for the service graph.

## Cross-references to migration

For the v1 → v2 port playbook on each feature, see the matching file in [`features/`](../../../migration-v1-to-v2/knowledge/features/) — same filename, different angle. **Exception:** features introduced in v2 with no v1 equivalent (`leverage-yield.md`, `leverage-yield-api.md`, `swaps-api.md`) have no migration sibling — there is nothing to port.
