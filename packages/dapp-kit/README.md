# @sodax/dapp-kit

High-level React hooks library for dApp developers. Wraps `@sodax/sdk` with React Query into feature-organized hooks. Used alongside `@sodax/wallet-sdk-react` (no direct dependency — shared types come from `@sodax/sdk`).

## Features

- **Swap/Intent** — `useQuote`, `useSwap`, `useSwapAllowance`, `useSwapApprove`, `useCancelSwap`, `useCreateLimitOrder`, `useCancelLimitOrder`, `useStatus`
- **Bridge** — `useBridge`, `useBridgeAllowance`, `useBridgeApprove`, `useGetBridgeableAmount`, `useGetBridgeableTokens`
- **Money Market** — `useSupply`, `useWithdraw`, `useBorrow`, `useRepay`, `useMMAllowance`, `useMMApprove`, plus reserves data hooks
- **Staking** — `useStake`, `useUnstake`, `useInstantUnstake`, `useClaim`, `useCancelUnstake`, approval hooks, info/config/ratio queries
- **DEX** — `useDexDeposit`, `useDexWithdraw`, `useSupplyLiquidity`, `useDecreaseLiquidity`, `useClaimRewards`, pool/position queries, param builders
- **Migration** — `useMigrateIcxToSoda`, `useRevertMigrateSodaToIcx`, `useMigratebnUSD`, `useMigrateBaln`, `useMigrationApprove`, `useMigrationAllowance`
- **Bitcoin (Radfi)** — `useRadfiAuth`, `useRadfiSession`, `useTradingWallet`, `useTradingWalletBalance`, `useBitcoinBalance`, `useFundTradingWallet`, `useRadfiWithdraw`, `useExpiredUtxos`, `useRenewUtxos`
- **Partner** — `useFetchAssetsBalances`, `useGetAutoSwapPreferences`, `useIsTokenApproved`, `useApproveToken`, `useSetSwapPreference`, `useFeeClaimSwap`
- **Recovery** — `useHubAssetBalances`, `useWithdrawHubAsset`
- **Backend Queries** — Intent tracking, orderbook, money market position queries
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
import { ChainKeys, type DeepPartial, type SodaxConfig } from '@sodax/sdk';

const queryClient = createSodaxQueryClient();

const sodaxConfig: DeepPartial<SodaxConfig> = {
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

- Node.js >= 18.0.0
- React >= 18
- TypeScript

## API Reference

### Provider

- [`SodaxProvider`](src/providers/SodaxProvider.tsx) — Wraps your app, creates the `Sodax` SDK instance. Accepts `config?: DeepPartial<SodaxConfig>`.
- [`createSodaxQueryClient()`](src/providers/createSodaxQueryClient.ts) — Factory for a `QueryClient` with global mutation observability (`onMutationError` hook, `meta.silent` opt-out).

### Swap Hooks

- [`useQuote()`](src/hooks/swap/useQuote.ts) — Real-time quote (auto-refreshes every 3s)
- [`useSwap()`](src/hooks/swap/useSwap.ts) — Submit a cross-chain swap intent
- [`useSwapAllowance()`](src/hooks/swap/useSwapAllowance.ts) — Check token approval
- [`useSwapApprove()`](src/hooks/swap/useSwapApprove.ts) — Approve token spending
- [`useStatus()`](src/hooks/swap/useStatus.ts) — Track intent execution status
- [`useCancelSwap()`](src/hooks/swap/useCancelSwap.ts) — Cancel a pending swap
- [`useCreateLimitOrder()`](src/hooks/swap/useCreateLimitOrder.ts) — Create a limit order (no deadline)
- [`useCancelLimitOrder()`](src/hooks/swap/useCancelLimitOrder.ts) — Cancel a limit order

### Money Market Hooks

- [`useSupply()`](src/hooks/mm/useSupply.ts) — Supply collateral
- [`useWithdraw()`](src/hooks/mm/useWithdraw.ts) — Withdraw supplied tokens
- [`useBorrow()`](src/hooks/mm/useBorrow.ts) — Borrow against collateral
- [`useRepay()`](src/hooks/mm/useRepay.ts) — Repay borrowed tokens
- [`useMMAllowance()`](src/hooks/mm/useMMAllowance.ts) — Check approval (auto-skips for borrow/withdraw)
- [`useMMApprove()`](src/hooks/mm/useMMApprove.ts) — Approve token spending
- [`useReservesData()`](src/hooks/mm/useReservesData.ts) — All reserve data
- [`useReservesHumanized()`](src/hooks/mm/useReservesHumanized.ts) — Reserves in decimal-normalized format
- [`useReservesList()`](src/hooks/mm/useReservesList.ts) — List of reserve asset addresses
- [`useReservesUsdFormat()`](src/hooks/mm/useReservesUsdFormat.ts) — Reserves with USD values
- [`useUserFormattedSummary()`](src/hooks/mm/useUserFormattedSummary.ts) — User portfolio summary (health factor, collateral, debt)
- [`useUserReservesData()`](src/hooks/mm/useUserReservesData.ts) — User reserve positions
- [`useAToken()`](src/hooks/mm/useAToken.ts) — aToken metadata
- [`useATokensBalances()`](src/hooks/mm/useATokensBalances.ts) — aToken balances

### Bridge Hooks

- [`useBridge()`](src/hooks/bridge/useBridge.ts) — Execute a cross-chain bridge transfer
- [`useBridgeAllowance()`](src/hooks/bridge/useBridgeAllowance.ts) — Check token approval
- [`useBridgeApprove()`](src/hooks/bridge/useBridgeApprove.ts) — Approve token spending
- [`useGetBridgeableAmount()`](src/hooks/bridge/useGetBridgeableAmount.ts) — Max bridgeable amount between two tokens
- [`useGetBridgeableTokens()`](src/hooks/bridge/useGetBridgeableTokens.ts) — Tokens bridgeable to a destination chain

### Staking Hooks

- [`useStake()`](src/hooks/staking/useStake.ts) — Stake SODA, receive xSODA
- [`useUnstake()`](src/hooks/staking/useUnstake.ts) — Request unstake (waiting period)
- [`useInstantUnstake()`](src/hooks/staking/useInstantUnstake.ts) — Instant unstake with slippage
- [`useClaim()`](src/hooks/staking/useClaim.ts) — Claim SODA after waiting period
- [`useCancelUnstake()`](src/hooks/staking/useCancelUnstake.ts) — Cancel pending unstake
- [`useStakeApprove()`](src/hooks/staking/useStakeApprove.ts) — Approve SODA for staking
- [`useUnstakeApprove()`](src/hooks/staking/useUnstakeApprove.ts) — Approve xSODA for unstaking
- [`useInstantUnstakeApprove()`](src/hooks/staking/useInstantUnstakeApprove.ts) — Approve xSODA for instant unstaking
- [`useStakeAllowance()`](src/hooks/staking/useStakeAllowance.ts) — Check SODA approval
- [`useUnstakeAllowance()`](src/hooks/staking/useUnstakeAllowance.ts) — Check xSODA approval for unstaking
- [`useInstantUnstakeAllowance()`](src/hooks/staking/useInstantUnstakeAllowance.ts) — Check xSODA approval for instant unstaking
- [`useStakingInfo()`](src/hooks/staking/useStakingInfo.ts) — User staking position
- [`useUnstakingInfo()`](src/hooks/staking/useUnstakingInfo.ts) — Pending unstake requests
- [`useUnstakingInfoWithPenalty()`](src/hooks/staking/useUnstakingInfoWithPenalty.ts) — Unstake requests with penalty calcs
- [`useStakingConfig()`](src/hooks/staking/useStakingConfig.ts) — Unstaking period, max penalty
- [`useStakeRatio()`](src/hooks/staking/useStakeRatio.ts) — SODA-to-xSODA exchange rate
- [`useInstantUnstakeRatio()`](src/hooks/staking/useInstantUnstakeRatio.ts) — Instant unstake rate
- [`useConvertedAssets()`](src/hooks/staking/useConvertedAssets.ts) — xSODA to SODA conversion

### DEX Hooks

- [`usePools()`](src/hooks/dex/usePools.ts) — List available pools
- [`usePoolData()`](src/hooks/dex/usePoolData.ts) — Pool details (price, tick, liquidity)
- [`usePoolBalances()`](src/hooks/dex/usePoolBalances.ts) — User pool token balances
- [`usePositionInfo()`](src/hooks/dex/usePositionInfo.ts) — Position details by token ID
- [`useDexDeposit()`](src/hooks/dex/useDexDeposit.ts) — Deposit assets into pool tokens
- [`useDexWithdraw()`](src/hooks/dex/useDexWithdraw.ts) — Withdraw assets from pool tokens
- [`useDexAllowance()`](src/hooks/dex/useDexAllowance.ts) — Check approval for deposit
- [`useDexApprove()`](src/hooks/dex/useDexApprove.ts) — Approve token spending
- [`useLiquidityAmounts()`](src/hooks/dex/useLiquidityAmounts.ts) — Token amounts for a tick range
- [`useSupplyLiquidity()`](src/hooks/dex/useSupplyLiquidity.ts) — Supply liquidity to a position
- [`useDecreaseLiquidity()`](src/hooks/dex/useDecreaseLiquidity.ts) — Remove liquidity
- [`useClaimRewards()`](src/hooks/dex/useClaimRewards.ts) — Claim trading fees
- [`useCreateDepositParams()`](src/hooks/dex/useCreateDepositParams.ts) — Build deposit params with ERC-4626 conversion
- [`useCreateWithdrawParams()`](src/hooks/dex/useCreateWithdrawParams.ts) — Build withdraw params
- [`useCreateSupplyLiquidityParams()`](src/hooks/dex/useCreateSupplyLiquidityParams.ts) — Build tick range + liquidity params
- [`useCreateDecreaseLiquidityParams()`](src/hooks/dex/useCreateDecreaseLiquidityParams.ts) — Build decrease params from position state

### Migration Hooks

- [`useMigrateIcxToSoda()`](src/hooks/migrate/useMigrateIcxToSoda.ts) — ICX/wICX (ICON) → SODA (Sonic)
- [`useRevertMigrateSodaToIcx()`](src/hooks/migrate/useRevertMigrateSodaToIcx.ts) — SODA (Sonic) → wICX (ICON)
- [`useMigratebnUSD()`](src/hooks/migrate/useMigratebnUSD.ts) — Legacy bnUSD ↔ new bnUSD (bidirectional)
- [`useMigrateBaln()`](src/hooks/migrate/useMigrateBaln.ts) — BALN (ICON) → SODA with optional lock period
- [`useMigrationApprove()`](src/hooks/migrate/useMigrationApprove.ts) — Approve token spending before migration
- [`useMigrationAllowance()`](src/hooks/migrate/useMigrationAllowance.ts) — Check if approval is needed

### Bitcoin (Radfi) Hooks

- [`useRadfiSession()`](src/hooks/bitcoin/useRadfiSession.ts) — Manage Radfi session (login, auto-refresh)
- [`useRadfiAuth()`](src/hooks/bitcoin/useRadfiAuth.ts) — Authenticate with Radfi via BIP322 signing
- [`useTradingWallet()`](src/hooks/bitcoin/useTradingWallet.ts) — Get trading wallet address from persisted session
- [`useBitcoinBalance()`](src/hooks/bitcoin/useBitcoinBalance.ts) — BTC balance for any address
- [`useTradingWalletBalance()`](src/hooks/bitcoin/useTradingWalletBalance.ts) — Trading wallet balance from Radfi API
- [`useFundTradingWallet()`](src/hooks/bitcoin/useFundTradingWallet.ts) — Fund trading wallet from personal wallet
- [`useRadfiWithdraw()`](src/hooks/bitcoin/useRadfiWithdraw.ts) — Withdraw from trading wallet
- [`useExpiredUtxos()`](src/hooks/bitcoin/useExpiredUtxos.ts) — Fetch expired UTXOs (polls every 60s)
- [`useRenewUtxos()`](src/hooks/bitcoin/useRenewUtxos.ts) — Renew expired UTXOs

### Partner Hooks

- [`useFetchAssetsBalances()`](src/hooks/partner/useFetchAssetsBalances.ts) — Fetch partner asset balances
- [`useGetAutoSwapPreferences()`](src/hooks/partner/useGetAutoSwapPreferences.ts) — Get auto-swap preferences
- [`useIsTokenApproved()`](src/hooks/partner/useIsTokenApproved.ts) — Check token approval
- [`useApproveToken()`](src/hooks/partner/useApproveToken.ts) — Approve token
- [`useSetSwapPreference()`](src/hooks/partner/useSetSwapPreference.ts) — Set swap preference
- [`useFeeClaimSwap()`](src/hooks/partner/useFeeClaimSwap.ts) — Claim partner fees via swap

### Recovery Hooks

- [`useHubAssetBalances()`](src/hooks/recovery/useHubAssetBalances.ts) — Get hub asset balances
- [`useWithdrawHubAsset()`](src/hooks/recovery/useWithdrawHubAsset.ts) — Withdraw hub asset

### Shared Hooks

- [`useSodaxContext()`](src/hooks/shared/useSodaxContext.ts) — Access the `Sodax` SDK instance
- [`useHubProvider()`](src/hooks/provider/useHubProvider.ts) — Access the hub chain (Sonic) provider
- [`useXBalances()`](src/hooks/shared/useXBalances.ts) — Cross-chain token balances for an address
- [`useDeriveUserWalletAddress()`](src/hooks/shared/useDeriveUserWalletAddress.ts) — Derive hub wallet address (CREATE3)
- [`useGetUserHubWalletAddress()`](src/hooks/shared/useGetUserHubWalletAddress.ts) — Derive hub wallet address (wallet router)
- [`useEstimateGas()`](src/hooks/shared/useEstimateGas.ts) — Estimate gas for transactions
- [`useStellarTrustlineCheck()`](src/hooks/shared/useStellarTrustlineCheck.ts) — Check Stellar trustline
- [`useRequestTrustline()`](src/hooks/shared/useRequestTrustline.ts) — Request Stellar trustline

### Backend Query Hooks

- [`useBackendIntentByTxHash()`](src/hooks/backend/useBackendIntentByTxHash.ts) — Get intent by hub tx hash (polls 1s)
- [`useBackendIntentByHash()`](src/hooks/backend/useBackendIntentByHash.ts) — Get intent by intent hash
- [`useBackendUserIntents()`](src/hooks/backend/useBackendUserIntents.ts) — All intents for a user with date filtering
- [`useBackendOrderbook()`](src/hooks/backend/useBackendOrderbook.ts) — Solver orderbook (cached 30s, no auto-refetch)
- [`useBackendMoneyMarketPosition()`](src/hooks/backend/useBackendMoneyMarketPosition.ts) — User money market position
- [`useBackendAllMoneyMarketAssets()`](src/hooks/backend/useBackendAllMoneyMarketAssets.ts) — All MM assets
- [`useBackendMoneyMarketAsset()`](src/hooks/backend/useBackendMoneyMarketAsset.ts) — Single MM asset details
- [`useBackendMoneyMarketAssetBorrowers()`](src/hooks/backend/useBackendMoneyMarketAssetBorrowers.ts) — Asset borrowers
- [`useBackendMoneyMarketAssetSuppliers()`](src/hooks/backend/useBackendMoneyMarketAssetSuppliers.ts) — Asset suppliers
- [`useBackendAllMoneyMarketBorrowers()`](src/hooks/backend/useBackendAllMoneyMarketBorrowers.ts) — All borrowers
- [`useBackendSubmitSwapTx()`](src/hooks/backend/useBackendSubmitSwapTx.ts) — Submit swap tx to backend
- [`useBackendSubmitSwapTxStatus()`](src/hooks/backend/useBackendSubmitSwapTxStatus.ts) — Check submitted swap status

### DEX Utils

- [`createDepositParamsProps()`](src/utils/dex-utils.ts) — Build deposit params from pool data and spoke asset info
- [`createWithdrawParamsProps()`](src/utils/dex-utils.ts) — Build withdraw params with optional destination info
- [`createSupplyLiquidityParamsProps()`](src/utils/dex-utils.ts) — Build concentrated liquidity supply params
- [`createDecreaseLiquidityParamsProps()`](src/utils/dex-utils.ts) — Build decrease liquidity params

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

**Recommended: [Claude Skills CLI](https://github.com/mattpocock/skills)** — from your project root:

```bash
npx skills@latest add icon-project/sodax-sdks/packages/skills
```

**npm fallback** (for agents that don't use the CLI — Cursor, Codex, Copilot, plain ChatGPT):

```bash
pnpm add -D @sodax/skills
```

Then point your agent at `node_modules/@sodax/skills/AGENTS.md`. See [docs/ai-integration-guide.md](https://github.com/icon-project/sodax-sdks/blob/main/docs/ai-integration-guide.md) for the full setup (per-tool rules files, prompt examples).

## License

[MIT](LICENSE)

## Support

- [GitHub Issues](https://github.com/icon-project/sodax-sdks/issues)
- [Discord Community](https://discord.gg/sodax-formerly-icon-880651922682560582)
