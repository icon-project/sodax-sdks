# Skill: Wallet Connectivity

Connect wallets and pass wallet providers to feature hooks.

**Depends on:** [setup.md](setup.md)

## Hooks

| Hook | Package | Type | Purpose |
|------|---------|------|---------|
| `useWalletProvider` | `@sodax/wallet-sdk-react` | Utility | Get wallet provider for a chain from connected wallet |
| `useHubProvider` | `@sodax/dapp-kit` | Utility | Access the hub chain (Sonic) provider |
| `useDeriveUserWalletAddress` | `@sodax/dapp-kit` | Query | Derive hub wallet address from spoke address (CREATE3) |
| `useGetUserHubWalletAddress` | `@sodax/dapp-kit` | Query | Derive hub wallet address via wallet router |
| `useXBalances` | `@sodax/dapp-kit` | Query | Cross-chain token balances for an address |
| `useEstimateGas` | `@sodax/dapp-kit` | Mutation | Estimate gas for raw transactions |
| `useStellarTrustlineCheck` | `@sodax/dapp-kit` | Query | Check if Stellar account has sufficient trustline |
| `useRequestTrustline` | `@sodax/dapp-kit` | Mutation | Request a Stellar trustline for a token |

## Connect a Wallet

`@sodax/wallet-sdk-react` provides per-chain wallet hooks:

```tsx
import { useEvmWallet } from '@sodax/wallet-sdk-react';

function ConnectButton() {
  const { connect, disconnect, address, isConnected } = useEvmWallet();

  if (isConnected) {
    return (
      <div>
        <span>{address}</span>
        <button onClick={disconnect}>Disconnect</button>
      </div>
    );
  }
  return <button onClick={() => connect()}>Connect Wallet</button>;
}
```

## Get a Wallet Provider

`useWalletProvider` returns a typed wallet provider for a specific chain. Pass it directly to feature hook mutation calls:

```tsx
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function MyFeature() {
  const walletProvider = useWalletProvider(ChainKeys.BSC_MAINNET);
  // undefined until wallet is connected for that chain
  // Pass as: useSwap() then swap({ params, walletProvider })
}
```

## Fetch Token Balances

`useXBalances` from `@sodax/dapp-kit` fetches on-chain balances for a wallet address:

```tsx
import { useXBalances } from '@sodax/dapp-kit';
import { BSC_MAINNET_CHAIN_ID } from '@sodax/sdk';

function TokenBalance({ address }: { address: string }) {
  const { data: balances } = useXBalances({
    params: { xChainId: BSC_MAINNET_CHAIN_ID, address },
  });

  // balances is a map of token address → balance (bigint)
}
```

## Use Wallet Provider in Feature Hooks

All mutation hooks accept no arguments at initialization level. The `walletProvider` flows through `mutate(vars)`:

```tsx
import { useSwap } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function SwapButton() {
  const walletProvider = useWalletProvider(ChainKeys.BSC_MAINNET);
  const { mutateAsync: swap, isPending } = useSwap();

  const handleSwap = async () => {
    if (!walletProvider) return;
    const result = await swap({ params: intentParams, walletProvider });
    // ...
  };
}
```

This pattern is consistent across all features: `useSwap`, `useBridge`, `useSupply`, `useStake`, `useDexDeposit`, etc.
