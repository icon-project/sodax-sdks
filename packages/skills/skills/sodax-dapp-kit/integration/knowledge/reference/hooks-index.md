# Hooks index — `@sodax/dapp-kit` v2

Comprehensive hook table across 11 feature domains. Use this when you know the feature you're building but don't remember the exact hook name.

## Provider + context

| Hook | Type | Purpose |
|---|---|---|
| `SodaxProvider` | Component | Wraps app; provides `Sodax` instance + RPC config |
| `createSodaxQueryClient` | Factory | Returns `QueryClient` with global mutation observability |
| `useSodaxContext` | Utility | Access the `Sodax` SDK instance |
| `useHubProvider` | Utility | Hub chain (Sonic) provider |

## Swap

| Hook | Type | Purpose |
|---|---|---|
| `useQuote` | Query | Real-time swap quote (auto-refreshes 3s) |
| `useSwap` | Mutation | Execute a complete cross-chain swap |
| `useSwapAllowance` | Query | Check token approval status |
| `useSwapApprove` | Mutation | Approve tokens for the swap contract |
| `useStatus` | Query | Track intent execution status (polls 3s once `intentTxHash` supplied; Result-wrapped data) |
| `useCancelSwap` | Mutation | Cancel an active swap intent |
| `useCreateLimitOrder` | Mutation | Create a limit order (no deadline) |
| `useCancelLimitOrder` | Mutation | Cancel a limit order |

## Money market

| Hook | Type | Purpose |
|---|---|---|
| `useSupply` | Mutation | Supply tokens as collateral |
| `useWithdraw` | Mutation | Withdraw supplied tokens |
| `useBorrow` | Mutation | Borrow against collateral |
| `useRepay` | Mutation | Repay borrowed tokens |
| `useMMAllowance` | Query | Approval check (`enabled: false` for borrow/withdraw — `data` stays `undefined`) |
| `useMMApprove` | Mutation | Approve tokens |
| `useReservesData` | Query | All reserve data (raw) |
| `useReservesHumanized` | Query | Reserves in decimal-normalized form |
| `useReservesList` | Query | List of reserve asset addresses |
| `useReservesUsdFormat` | Query | Reserves with USD overlays |
| `useUserFormattedSummary` | Query | Health factor, collateral, debt summary |
| `useUserReservesData` | Query | Per-reserve user position |
| `useAToken` | Query | aToken metadata |
| `useATokensBalances` | Query | aToken balances |

## Bridge

| Hook | Type | Purpose |
|---|---|---|
| `useBridge` | Mutation | Execute a cross-chain bridge transfer |
| `useBridgeAllowance` | Query | Approval check |
| `useBridgeApprove` | Mutation | Approve tokens for bridge |
| `useGetBridgeableAmount` | Query | Max bridgeable amount between two `XToken`s |
| `useGetBridgeableTokens` | Query | Tokens bridgeable to a destination chain |

## Staking

| Hook | Type | Purpose |
|---|---|---|
| `useStake` | Mutation | Stake SODA, receive xSODA |
| `useUnstake` | Mutation | Request unstake (waiting period) |
| `useInstantUnstake` | Mutation | Instant unstake (with slippage) |
| `useClaim` | Mutation | Claim SODA after waiting period |
| `useCancelUnstake` | Mutation | Cancel pending unstake |
| `useStakeApprove` | Mutation | Approve SODA for staking |
| `useUnstakeApprove` | Mutation | Approve xSODA for unstaking |
| `useInstantUnstakeApprove` | Mutation | Approve xSODA for instant unstaking |
| `useStakeAllowance` | Query | Check SODA approval |
| `useUnstakeAllowance` | Query | Check xSODA approval (unstaking) |
| `useInstantUnstakeAllowance` | Query | Check xSODA approval (instant) |
| `useStakingInfo` | Query | User position |
| `useUnstakingInfo` | Query | Pending unstake requests |
| `useUnstakingInfoWithPenalty` | Query | Pending requests + penalty calcs |
| `useStakingConfig` | Query | Unstaking period, max penalty |
| `useStakeRatio` | Query | SODA-to-xSODA exchange rate (returns tuple) |
| `useInstantUnstakeRatio` | Query | Instant unstake rate |
| `useConvertedAssets` | Query | xSODA → SODA conversion |

## DEX

| Hook | Type | Purpose |
|---|---|---|
| `usePools` | Query | List available pools (synchronous; no auto-refresh) |
| `usePoolData` | Query | Pool details (price, tick, liquidity) |
| `usePoolBalances` | Query | User's pool token balances |
| `usePositionInfo` | Query | Position details by tokenId |
| `useLiquidityAmounts` | Query | Token amounts for a tick range |
| `useDexDeposit` | Mutation | Deposit assets into pool tokens |
| `useDexWithdraw` | Mutation | Withdraw assets from pool tokens |
| `useDexAllowance` | Query | Approval check |
| `useDexApprove` | Mutation | Approve tokens |
| `useSupplyLiquidity` | Mutation | Supply liquidity (mint or increase) |
| `useDecreaseLiquidity` | Mutation | Remove liquidity |
| `useClaimRewards` | Mutation | Claim trading fees |
| `useCreateDepositParams` | Param builder | Build deposit params with ERC-4626 conversion |
| `useCreateWithdrawParams` | Param builder | Build withdraw params |
| `useCreateSupplyLiquidityParams` | Param builder | Build tick-range + liquidity params |
| `useCreateDecreaseLiquidityParams` | Param builder | Build decrease params from position state |

## Migration

| Hook | Type | Purpose |
|---|---|---|
| `useMigrateIcxToSoda` | Mutation | ICX/wICX (ICON) → SODA (Sonic) |
| `useRevertMigrateSodaToIcx` | Mutation | SODA (Sonic) → wICX (ICON) |
| `useMigratebnUSD` | Mutation | Legacy bnUSD ↔ new bnUSD (bidirectional) |
| `useMigrateBaln` | Mutation | BALN (ICON) → SODA with optional lock period |
| `useMigrationApprove` | Mutation | Approve before migration (action-discriminated) |
| `useMigrationAllowance` | Query | Approval check (action-discriminated) |

## Bitcoin / Radfi

| Hook | Type | Purpose |
|---|---|---|
| `useRadfiAuth` | Mutation | Authenticate via BIP322 signing |
| `useRadfiSession` | Utility | Manage full session lifecycle |
| `useTradingWallet` | Utility | Synchronously read trading wallet from localStorage |
| `useBitcoinBalance` | Query | BTC balance for any address |
| `useTradingWalletBalance` | Query | Trading wallet balance from Radfi API |
| `useFundTradingWallet` | Mutation | Fund trading wallet from personal wallet |
| `useRadfiWithdraw` | Mutation | Withdraw from trading wallet |
| `useExpiredUtxos` | Query | Expired UTXOs (polls 60s) |
| `useRenewUtxos` | Mutation | Renew expired UTXOs |

## Backend queries

### Intents

| Hook | Polling |
|---|---|
| `useBackendIntentByTxHash` | 1s (refetchInterval; fires once a `txHash` is set, unconditional) |
| `useBackendIntentByHash` | none |
| `useBackendUserIntents` | none |

### Orderbook + swap submission

| Hook | Type / Polling |
|---|---|
| `useBackendOrderbook` | Query; `staleTime: 30s` — fresh-window only, no background refetch |
| `useBackendSubmitSwapTx` | Mutation |
| `useBackendSubmitSwapTxStatus` | Query; polls until `executed` / `failed` |

### Money market data

| Hook | Purpose |
|---|---|
| `useBackendMoneyMarketPosition` | User position |
| `useBackendMoneyMarketAsset` | Asset details |
| `useBackendAllMoneyMarketAssets` | All MM assets |
| `useBackendMoneyMarketAssetSuppliers` | Suppliers for an asset |
| `useBackendMoneyMarketAssetBorrowers` | Borrowers for an asset |
| `useBackendAllMoneyMarketBorrowers` | All borrowers |

## Partner

| Hook | Type | Purpose |
|---|---|---|
| `useFetchAssetsBalances` | Query | Fetch partner asset balances |
| `useGetAutoSwapPreferences` | Query | Get auto-swap preferences |
| `useIsTokenApproved` | Query | Check token approval |
| `useApproveToken` | Mutation | Approve token |
| `useSetSwapPreference` | Mutation | Set swap preference |
| `useFeeClaimSwap` | Mutation | Claim partner fees via swap |

## Recovery

| Hook | Type | Purpose |
|---|---|---|
| `useHubAssetBalances` | Query | Hub asset balances |
| `useWithdrawHubAsset` | Mutation | Withdraw hub asset |

## Shared

| Hook | Type | Purpose |
|---|---|---|
| `useXBalances` | Query | Cross-chain token balances |
| `useDeriveUserWalletAddress` | Query | Derive hub wallet (CREATE3) |
| `useGetUserHubWalletAddress` | Query | Derive hub wallet (wallet router) |
| `useEstimateGas` | Mutation | Estimate gas for raw tx |
| `useStellarTrustlineCheck` | Query | Check Stellar trustline |
| `useRequestTrustline` | Mutation | Request a Stellar trustline |
| `useSafeMutation` | Internal | The wrapper every mutation hook calls |
| `unwrapResult` | Internal | `Result<T>` → throw / return |
| `toResult` | Internal | `Promise<T>` → `Result<T>` |

## Cross-references

- [`../features/`](../features/) — per-feature reference docs (params types, return shapes, gotchas).
- [`../recipes/`](../recipes/) — copy-paste worked examples per feature.
- [`querykey-conventions.md`](querykey-conventions.md) — queryKey/mutationKey shape rules.
