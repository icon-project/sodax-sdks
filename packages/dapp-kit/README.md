# @sodax/dapp-kit

High-level React hooks library for dApp developers. Wraps `@sodax/sdk` with React Query into feature-organized hooks. Used alongside `@sodax/wallet-sdk-react` (no direct dependency — shared types come from `@sodax/sdk`).

## Features

- **Swap/Intent** — `useQuote`, `useSwap`, `useSwapAllowance`, `useSwapApprove`, `useCancelSwap`, `useCreateLimitOrder`, `useCancelLimitOrder`, `useStatus`
- **Bridge** — `useBridge`, `useBridgeAllowance`, `useBridgeApprove`, `useGetBridgeableAmount`, `useGetBridgeableTokens`
- **Money Market** — `useSupply`, `useWithdraw`, `useBorrow`, `useRepay`, `useMMAllowance`, `useMMApprove`, plus reserves data hooks
- **Staking** — `useStake`, `useUnstake`, `useInstantUnstake`, `useClaim`, `useCancelUnstake`, approval hooks, info/config/ratio queries
- **DEX** — `useDexDeposit`, `useDexWithdraw`, `useSupplyLiquidity`, `useDecreaseLiquidity`, `useClaimRewards`, pool/position queries, param builders
- **Migration** — `useMigrateIcxToSoda`, `useRevertMigrateSodaToIcx`, `useMigratebnUSD`, `useMigrateBaln`, `useMigrationApprove`, `useMigrationAllowance`
- **Bitcoin (Bound Exchange)** — `useRadfiAuth`, `useRadfiSession`, `useTradingWallet`, `useTradingWalletBalance`, `useBitcoinBalance`, `useFundTradingWallet`, `useRadfiWithdraw`, `useExpiredUtxos`, `useRenewUtxos`
- **Partner** — `useFetchAssetsBalances`, `useGetAutoSwapPreferences`, `useIsTokenApproved`, `useApproveToken`, `useSetSwapPreference`, `useFeeClaimSwap`
- **Recovery** — `useHubAssetBalances`, `useWithdrawHubAsset`
- **Backend Queries** — Intent tracking, swap-tx submission + status, orderbook, money market position queries
- **Shared** — `useXBalances`, `useDeriveUserWalletAddress`, `useGetUserHubWalletAddress`, `useStellarTrustlineCheck`, `useRequestTrustline`, `useEstimateGas`

## Installation

```bash
pnpm add @sodax/dapp-kit @tanstack/react-query
# Optional: wallet connectivity
pnpm add @sodax/wallet-sdk-react
```

## Quick Start

### 1. Set up providers

RPC URLs are injected through `config.chains`. `SodaxProvider` is the outermost wrapper; `QueryClientProvider` wraps everything inside it.

```tsx
// providers.tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { SodaxProvider, createSodaxQueryClient } from '@sodax/dapp-kit';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { ChainKeys, type SodaxOptions } from '@sodax/sdk';

const queryClient = createSodaxQueryClient();

const sodaxConfig: SodaxOptions = {
  chains: {
    [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://sonic-rpc.publicnode.com' },
    [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc-dataseed.binance.org' },
    [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://base.drpc.org' },
    [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://arb1.arbitrum.io/rpc' },
    // Add chains your dApp needs
  },
};

const walletConfig: SodaxWalletConfig = {
  EVM: {
    chains: {
      [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc-dataseed.binance.org' },
      [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://base.drpc.org' },
    },
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SodaxProvider config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>
        <SodaxWalletProvider config={walletConfig}>
          {children}
        </SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}
```

### 2. Get a wallet provider

```tsx
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function MyFeature() {
  const walletProvider = useWalletProvider(ChainKeys.BSC_MAINNET);
  // undefined until wallet is connected
}
```

### 3. Use feature hooks

All mutation hooks accept no arguments at initialization. Domain inputs (params, walletProvider) flow through `mutate(vars)`:

```tsx
import { useSwap } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import type { CreateIntentParams } from '@sodax/sdk';

function SwapButton({ intentParams }: { intentParams: CreateIntentParams }) {
  const walletProvider = useWalletProvider(ChainKeys.BSC_MAINNET);
  const { mutateAsyncSafe: swap, isPending } = useSwap();

  const handleSwap = async () => {
    if (!walletProvider) return;
    const result = await swap({ params: intentParams, walletProvider });
    if (!result.ok) {
      alert(result.error instanceof Error ? result.error.message : 'Swap failed');
      return;
    }
    console.log('Swap submitted!', result.value);
  };

  return (
    <button onClick={handleSwap} disabled={isPending || !walletProvider}>
      {isPending ? 'Swapping...' : 'Swap'}
    </button>
  );
}
```

## Requirements

- Node.js >= 20.12.0
- React >= 18
- TypeScript

## API Reference

### Provider

- [`SodaxProvider`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/providers/SodaxProvider.tsx) — Wraps your app, creates the `Sodax` SDK instance. Accepts `config?: SodaxOptions`.
- [`createSodaxQueryClient()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/providers/createSodaxQueryClient.ts) — Factory for a `QueryClient` with global mutation observability (`onMutationError` hook, `meta.silent` opt-out).

### Swap Hooks

- [`useQuote()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useQuote.ts) — Real-time quote (auto-refreshes every 3s)
- [`useSwap()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useSwap.ts) — Submit a cross-chain swap intent
- [`useSwapAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useSwapAllowance.ts) — Check token approval
- [`useSwapApprove()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useSwapApprove.ts) — Approve token spending
- [`useStatus()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useStatus.ts) — Track intent execution status
- [`useCancelSwap()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useCancelSwap.ts) — Cancel a pending swap
- [`useCreateLimitOrder()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useCreateLimitOrder.ts) — Create a limit order (no deadline)
- [`useCancelLimitOrder()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useCancelLimitOrder.ts) — Cancel a limit order

### Money Market Hooks

- [`useSupply()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useSupply.ts) — Supply collateral
- [`useWithdraw()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useWithdraw.ts) — Withdraw supplied tokens
- [`useBorrow()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useBorrow.ts) — Borrow against collateral
- [`useRepay()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useRepay.ts) — Repay borrowed tokens
- [`useMMAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useMMAllowance.ts) — Check approval (auto-skips for borrow/withdraw)
- [`useMMApprove()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useMMApprove.ts) — Approve token spending
- [`useReservesData()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useReservesData.ts) — All reserve data
- [`useReservesHumanized()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useReservesHumanized.ts) — Reserves in decimal-normalized format
- [`useReservesList()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useReservesList.ts) — List of reserve asset addresses
- [`useReservesUsdFormat()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useReservesUsdFormat.ts) — Reserves with USD values
- [`useUserFormattedSummary()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useUserFormattedSummary.ts) — User portfolio summary (health factor, collateral, debt)
- [`useUserReservesData()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useUserReservesData.ts) — User reserve positions
- [`useAToken()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useAToken.ts) — aToken metadata
- [`useATokensBalances()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useATokensBalances.ts) — aToken balances

### Bridge Hooks

- [`useBridge()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bridge/useBridge.ts) — Execute a cross-chain bridge transfer
- [`useBridgeAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bridge/useBridgeAllowance.ts) — Check token approval
- [`useBridgeApprove()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bridge/useBridgeApprove.ts) — Approve token spending
- [`useGetBridgeableAmount()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bridge/useGetBridgeableAmount.ts) — Max bridgeable amount between two tokens
- [`useGetBridgeableTokens()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bridge/useGetBridgeableTokens.ts) — Tokens bridgeable to a destination chain

### Staking Hooks

- [`useStake()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useStake.ts) — Stake SODA, receive xSODA
- [`useUnstake()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useUnstake.ts) — Request unstake (waiting period)
- [`useInstantUnstake()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useInstantUnstake.ts) — Instant unstake with slippage
- [`useClaim()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useClaim.ts) — Claim SODA after waiting period
- [`useCancelUnstake()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useCancelUnstake.ts) — Cancel pending unstake
- [`useStakeApprove()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useStakeApprove.ts) — Approve SODA for staking
- [`useUnstakeApprove()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useUnstakeApprove.ts) — Approve xSODA for unstaking
- [`useInstantUnstakeApprove()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useInstantUnstakeApprove.ts) — Approve xSODA for instant unstaking
- [`useStakeAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useStakeAllowance.ts) — Check SODA approval
- [`useUnstakeAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useUnstakeAllowance.ts) — Check xSODA approval for unstaking
- [`useInstantUnstakeAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useInstantUnstakeAllowance.ts) — Check xSODA approval for instant unstaking
- [`useStakingInfo()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useStakingInfo.ts) — User staking position
- [`useUnstakingInfo()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useUnstakingInfo.ts) — Pending unstake requests
- [`useUnstakingInfoWithPenalty()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useUnstakingInfoWithPenalty.ts) — Unstake requests with penalty calcs
- [`useStakingConfig()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useStakingConfig.ts) — Unstaking period, max penalty
- [`useStakeRatio()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useStakeRatio.ts) — SODA-to-xSODA exchange rate
- [`useInstantUnstakeRatio()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useInstantUnstakeRatio.ts) — Instant unstake rate
- [`useConvertedAssets()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useConvertedAssets.ts) — xSODA to SODA conversion

### DEX Hooks

- [`usePools()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/usePools.ts) — List available pools
- [`usePoolData()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/usePoolData.ts) — Pool details (price, tick, liquidity)
- [`usePoolBalances()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/usePoolBalances.ts) — User pool token balances
- [`usePositionInfo()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/usePositionInfo.ts) — Position details by token ID
- [`useDexDeposit()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useDexDeposit.ts) — Deposit assets into pool tokens
- [`useDexWithdraw()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useDexWithdraw.ts) — Withdraw assets from pool tokens
- [`useDexAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useDexAllowance.ts) — Check approval for deposit
- [`useDexApprove()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useDexApprove.ts) — Approve token spending
- [`useLiquidityAmounts()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useLiquidityAmounts.ts) — Token amounts for a tick range
- [`useSupplyLiquidity()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useSupplyLiquidity.ts) — Supply liquidity to a position
- [`useDecreaseLiquidity()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useDecreaseLiquidity.ts) — Remove liquidity
- [`useClaimRewards()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useClaimRewards.ts) — Claim trading fees
- [`useCreateDepositParams()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useCreateDepositParams.ts) — Build deposit params with ERC-4626 conversion
- [`useCreateWithdrawParams()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useCreateWithdrawParams.ts) — Build withdraw params
- [`useCreateSupplyLiquidityParams()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useCreateSupplyLiquidityParams.ts) — Build tick range + liquidity params
- [`useCreateDecreaseLiquidityParams()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useCreateDecreaseLiquidityParams.ts) — Build decrease params from position state

### Migration Hooks

- [`useMigrateIcxToSoda()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/migrate/useMigrateIcxToSoda.ts) — ICX/wICX (ICON) → SODA (Sonic)
- [`useRevertMigrateSodaToIcx()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/migrate/useRevertMigrateSodaToIcx.ts) — SODA (Sonic) → wICX (ICON)
- [`useMigratebnUSD()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/migrate/useMigratebnUSD.ts) — Legacy bnUSD ↔ new bnUSD (bidirectional)
- [`useMigrateBaln()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/migrate/useMigrateBaln.ts) — BALN (ICON) → SODA with optional lock period
- [`useMigrationApprove()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/migrate/useMigrationApprove.ts) — Approve token spending before migration
- [`useMigrationAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/migrate/useMigrationAllowance.ts) — Check if approval is needed

### Bitcoin (Bound Exchange) Hooks

- [`useRadfiSession()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useRadfiSession.ts) — Manage Bound Exchange session (login, auto-refresh)
- [`useRadfiAuth()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useRadfiAuth.ts) — Authenticate with Bound Exchange via BIP322 signing
- [`useTradingWallet()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useTradingWallet.ts) — Get trading wallet address from persisted session
- [`useBitcoinBalance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useBitcoinBalance.ts) — BTC balance for any address
- [`useTradingWalletBalance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useTradingWalletBalance.ts) — Trading wallet balance from Bound Exchange API
- [`useFundTradingWallet()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useFundTradingWallet.ts) — Fund trading wallet from personal wallet
- [`useRadfiWithdraw()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useRadfiWithdraw.ts) — Withdraw from trading wallet
- [`useExpiredUtxos()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useExpiredUtxos.ts) — Fetch expired UTXOs (polls every 60s)
- [`useRenewUtxos()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useRenewUtxos.ts) — Renew expired UTXOs

### Partner Hooks

- [`useFetchAssetsBalances()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/partner/useFetchAssetsBalances.ts) — Fetch partner asset balances
- [`useGetAutoSwapPreferences()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/partner/useGetAutoSwapPreferences.ts) — Get auto-swap preferences
- [`useIsTokenApproved()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/partner/useIsTokenApproved.ts) — Check token approval
- [`useApproveToken()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/partner/useApproveToken.ts) — Approve token
- [`useSetSwapPreference()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/partner/useSetSwapPreference.ts) — Set swap preference
- [`useFeeClaimSwap()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/partner/useFeeClaimSwap.ts) — Claim partner fees via swap

### Recovery Hooks

- [`useHubAssetBalances()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/recovery/useHubAssetBalances.ts) — Get hub asset balances
- [`useWithdrawHubAsset()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/recovery/useWithdrawHubAsset.ts) — Withdraw hub asset

### Shared Hooks

- [`useSodaxContext()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useSodaxContext.ts) — Access the `Sodax` SDK instance
- [`useHubProvider()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/provider/useHubProvider.ts) — Access the hub chain (Sonic) provider
- [`useXBalances()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useXBalances.ts) — Cross-chain token balances for an address
- [`useDeriveUserWalletAddress()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useDeriveUserWalletAddress.ts) — Derive hub wallet address (CREATE3)
- [`useGetUserHubWalletAddress()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useGetUserHubWalletAddress.ts) — Derive hub wallet address (wallet router)
- [`useEstimateGas()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useEstimateGas.ts) — Estimate gas for transactions
- [`useStellarTrustlineCheck()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useStellarTrustlineCheck.ts) — Check Stellar trustline
- [`useRequestTrustline()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useRequestTrustline.ts) — Request Stellar trustline

### Backend Query Hooks

Full reference with parameters and usage snippets: [Backend Query Hooks](https://docs.sodax.com/developers/packages/experience/dapp-kit/backend-hooks).

- [`useBackendIntentByTxHash()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendIntentByTxHash.ts) — Get intent by hub tx hash (polls 1s)
- [`useBackendIntentByHash()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendIntentByHash.ts) — Get intent by intent hash
- [`useBackendUserIntents()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendUserIntents.ts) — All intents for a user with date filtering
- [`useBackendOrderbook()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendOrderbook.ts) — Solver orderbook (cached 30s, no auto-refetch)
- [`useBackendMoneyMarketPosition()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendMoneyMarketPosition.ts) — User money market position
- [`useBackendAllMoneyMarketAssets()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendAllMoneyMarketAssets.ts) — All MM assets
- [`useBackendMoneyMarketAsset()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendMoneyMarketAsset.ts) — Single MM asset details
- [`useBackendMoneyMarketAssetBorrowers()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendMoneyMarketAssetBorrowers.ts) — Asset borrowers
- [`useBackendMoneyMarketAssetSuppliers()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendMoneyMarketAssetSuppliers.ts) — Asset suppliers
- [`useBackendAllMoneyMarketBorrowers()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendAllMoneyMarketBorrowers.ts) — All borrowers

### Swaps API Hooks (`sodax.api.swaps`)

Typed wrappers over the backend Swaps API v2 — one `useSwapsApi*` hook per endpoint (21 total). Highlights:

- [`useSwapsApiQuote()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swapsApi/useSwapsApiQuote.ts) — Solver quote for a cross-chain swap
- [`useSwapsApiCreateIntent()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swapsApi/useSwapsApiCreateIntent.ts) — Build an unsigned create-intent tx
- [`useSwapsApiSubmitTx()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swapsApi/useSwapsApiSubmitTx.ts) — Submit swap tx to backend
- [`useSwapsApiSubmitTxStatus()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swapsApi/useSwapsApiSubmitTxStatus.ts) — Check submitted swap status

See [`src/hooks/swapsApi/`](https://github.com/icon-project/sodax-sdks/tree/main/packages/dapp-kit/src/hooks/swapsApi) for the full set (tokens, deadline, allowance, approve, submit/cancel intent, status, hash, packet, extra-data, intent lookups, limit orders, gas, fees).

### DEX Utils

- [`createDepositParamsProps()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/utils/dex-utils.ts) — Build deposit params from pool data and spoke asset info
- [`createWithdrawParamsProps()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/utils/dex-utils.ts) — Build withdraw params with optional destination info
- [`createSupplyLiquidityParamsProps()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/utils/dex-utils.ts) — Build concentrated liquidity supply params
- [`createDecreaseLiquidityParamsProps()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/utils/dex-utils.ts) — Build decrease liquidity params

## Development

```bash
pnpm install     # Install dependencies
pnpm build       # Build the package (ESM + CJS)
pnpm dev         # Watch mode
pnpm checkTs     # Type checking
pnpm test        # Run tests
pnpm pretty      # Format code
pnpm lint        # Lint code
```

## AI agent docs

AI-readable docs for `@sodax/dapp-kit` (and the other `@sodax/*` packages) are shipped via [`@sodax/skills`](https://github.com/icon-project/sodax-sdks/tree/main/packages/skills) — a separate npm package bundling Claude-Code SKILL.md files and a long-form knowledge tree.

**Recommended: [`skills` CLI](https://github.com/vercel-labs/skills)** — from your project root:

```bash
npx skills@latest add icon-project/sodax-sdks/packages/skills
```

**npm + `AGENTS.md` pointer** (fallback for web chats, or when you prefer a devDependency over the CLI):

```bash
pnpm add -D @sodax/skills
```

Then point your agent at `node_modules/@sodax/skills/AGENTS.md`. See [docs/ai-integration-guide.md](https://github.com/icon-project/sodax-sdks/blob/main/docs/ai-integration-guide.md) for all install modes and per-tool wiring.

## License

[MIT](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/LICENSE)

## Support

- [GitHub Issues](https://github.com/icon-project/sodax-sdks/issues)
- [Discord Community](https://discord.gg/sodax-formerly-icon-880651922682560582)
