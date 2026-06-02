# Recipe: Wallet Connectivity

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
// @ai-snippets-skip
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
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
  // undefined until wallet is connected for that chain
  // Pass as: useSwap() then swap({ params, walletProvider })
}
```

## Fetch Token Balances

`useXBalances` from `@sodax/dapp-kit` fetches on-chain balances for a wallet address:

```tsx
import { useXBalances } from '@sodax/dapp-kit';
import { useXService, getXChainType } from '@sodax/wallet-sdk-react';
import { ChainKeys, type XToken } from '@sodax/sdk';

function TokenBalance({ address, xTokens }: { address: string; xTokens: readonly XToken[] }) {
  const xChainId = ChainKeys.BSC_MAINNET;
  // `useXBalances` requires an `xService` from `@sodax/wallet-sdk-react` plus the chain key,
  // the token list to read, and the user's address — all four fields are part of `params`.
  const xService = useXService({ xChainType: getXChainType(xChainId) });
  const { data: balances } = useXBalances({
    params: { xService, xChainId, xTokens, address },
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
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
  const { mutateAsync: swap, isPending } = useSwap();

  const handleSwap = async () => {
    if (!walletProvider) return;
    const result = await swap({ params: intentParams, walletProvider });
    // ...
  };
}
```

This pattern is consistent across all features: `useSwap`, `useBridge`, `useSupply`, `useStake`, `useDexDeposit`, etc.

## No type cast is needed — broad-union wiring just works

A common anti-pattern is reaching for `as any` / `as IEvmWalletProvider` when the runtime-typed `walletProvider` from `useWalletProvider({ xChainId })` is passed into a mutation hook. **That cast is not needed.** v2 accepts the broad-union wallet-provider type as long as the chain key on the payload and the wallet provider both come from the same runtime `xChainId` value.

```tsx
// @ai-snippets-skip — illustrative anti-pattern vs correct
// ❌ ANTI-PATTERN — unnecessary cast
const walletProvider = useWalletProvider({ xChainId });
await swap({ params, walletProvider: walletProvider as any });           // don't
await swap({ params, walletProvider: walletProvider as IEvmWalletProvider }); // don't

// ✅ CORRECT — pass directly, TypeScript infers the relationship
const walletProvider = useWalletProvider({ xChainId });
if (!walletProvider) return;        // narrow undefined first
await swap({ params, walletProvider });
```

### Why this works

- `useWalletProvider({ xChainId })` returns `GetWalletProviderType<typeof xChainId> | undefined`. When `xChainId` is a runtime value (e.g. from props/state typed `SpokeChainKey`), the return type is the **broad union** `IWalletProvider | undefined`, not `any`.
- Mutation hooks like `useSwap<K>()` default `K` to the broad `SpokeChainKey` union. Their `mutate` vars are typed `{ params: SwapParams<SpokeChainKey>, walletProvider: GetWalletProviderType<SpokeChainKey> }` — i.e. `walletProvider` is the same broad union.
- The two unions are structurally assignable. No cast required.

### When the cast is actually needed

If you've narrowed `xChainId` to a literal (e.g. via `chainKey === ChainKeys.BSC_MAINNET` checks in a branch) and the mutation hook is also generic-narrowed, you'll get narrower types on both sides. Even there, the cast is usually unnecessary — TypeScript propagates the narrowed `K` through the hook's generic. Reach for a cast only when you can produce a real TS error message proving it's needed.
