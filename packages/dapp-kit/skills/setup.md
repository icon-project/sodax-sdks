# Skill: Setup

Install and wire `@sodax/dapp-kit` into a React project.

**Depends on:** None

## Install

```bash
# Required
pnpm add @sodax/dapp-kit @tanstack/react-query

# Optional (only if you want built-in wallet connectivity hooks + providers)
pnpm add @sodax/wallet-sdk-react
```

## Wire Providers

RPC URLs are injected via `config.chains` — each chain entry takes `{ rpcUrl: string }`.

```tsx
// providers.tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { SodaxProvider, createSodaxQueryClient } from '@sodax/dapp-kit';
import { ChainKeys, type DeepPartial, type SodaxConfig } from '@sodax/sdk';

const queryClient = createSodaxQueryClient();

const sodaxConfig: DeepPartial<SodaxConfig> = {
  chains: {
    [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://arb1.arbitrum.io/rpc' },
    [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://mainnet.base.org' },
    [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc-dataseed.binance.org' },
    [ChainKeys.POLYGON_MAINNET]: { rpcUrl: 'https://polygon-rpc.com' },
    // Add chains your dApp needs
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SodaxProvider config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </SodaxProvider>
  );
}
```

### Optional: Add Wallet Provider

If you want to use `@sodax/wallet-sdk-react` for wallet connectivity, wrap `SodaxWalletProvider` inside `QueryClientProvider`:

```tsx
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';

const walletConfig: SodaxWalletConfig = {
  EVM: {
    chains: {
      [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc-dataseed.binance.org' },
      [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://mainnet.base.org' },
    },
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SodaxProvider config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>
        <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}
```

## `createSodaxQueryClient` (optional)

`createSodaxQueryClient` returns a `QueryClient` pre-wired with a `MutationCache.onError` hook for global mutation observability. Use it instead of `new QueryClient()`:

```tsx
import { createSodaxQueryClient } from '@sodax/dapp-kit';

// Default: logs every mutation failure as `[sodax] Mutation error: <error>`
const queryClient = createSodaxQueryClient();

// Wire to your own logger
const queryClient = createSodaxQueryClient({
  onMutationError: (e) => Sentry.captureException(e),
});

// Silence a specific mutation locally via meta.silent
const swap = useSwap({
  mutationOptions: { meta: { silent: true }, onError: (e) => toast.error(e.message) },
});
```

## Initialize SDK (Optional)

For dynamic config (latest tokens/chains from backend API):

```tsx
import { useEffect } from 'react';
import { useSodaxContext } from '@sodax/dapp-kit';

export function useInitializeSodax() {
  const { sodax } = useSodaxContext();

  useEffect(() => {
    sodax.initialize().then((result) => {
      if (!result.ok) console.error('Failed to initialize Sodax:', result.error);
    });
  }, [sodax]);
}
```

## Chain Key Constants

```tsx
import {
  ChainKeys,
  // or individual constants:
  SONIC_MAINNET_CHAIN_ID,      // '0x92.sonic' (hub)
  ARBITRUM_MAINNET_CHAIN_ID,   // '0xa4b1.arbitrum'
  BASE_MAINNET_CHAIN_ID,       // '0x2105.base'
  BSC_MAINNET_CHAIN_ID,        // '0x38.bsc'
  ETHEREUM_MAINNET_CHAIN_ID,   // '0x1.ethereum'
  POLYGON_MAINNET_CHAIN_ID,    // '0x89.polygon'
  OPTIMISM_MAINNET_CHAIN_ID,   // '0xa.optimism'
  AVALANCHE_MAINNET_CHAIN_ID,  // '0xa86a.avalanche'
  SUI_MAINNET_CHAIN_ID,        // 'sui:mainnet'
  STELLAR_MAINNET_CHAIN_ID,    // 'stellar:mainnet'
  SOLANA_MAINNET_CHAIN_ID,     // 'solana:mainnet'
  ICON_MAINNET_CHAIN_ID,       // '0x1.icon'
  INJECTIVE_MAINNET_CHAIN_ID,  // 'injective-1'
  NEAR_MAINNET_CHAIN_ID,       // 'near:mainnet'
  STACKS_MAINNET_CHAIN_ID,     // 'stacks:mainnet'
  BITCOIN_MAINNET_CHAIN_ID,    // 'bitcoin:mainnet'
} from '@sodax/sdk';
```
