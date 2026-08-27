import { ChainKeys, SodaxProvider, type SodaxOptions, createSodaxQueryClient } from '@sodax/dapp-kit';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { rpcUrl, walletConnectProjectId } from './config';
import { type PlaygroundChainKey, swappableChains } from './lib/chains';

const queryClient = createSodaxQueryClient();

// The hub is always configured: the SDK routes and settles through Sonic regardless of which spoke
// chains the pickers offer.
const configuredChains = [...new Set<PlaygroundChainKey>([ChainKeys.SONIC_MAINNET, ...swappableChains])];

// The SDK and the wallet layer take structurally similar but separately-typed chain maps.
const sdkChains: NonNullable<SodaxOptions['chains']> = {};
const walletChains: NonNullable<NonNullable<SodaxWalletConfig['EVM']>['chains']> = {};

for (const key of configuredChains) {
  sdkChains[key] = { rpcUrl: rpcUrl(key) };
  walletChains[key] = { rpcUrl: rpcUrl(key) };
}

// SodaxProvider freezes its config by reference on first render, so these stay module constants.
const sodaxConfig: SodaxOptions = { chains: sdkChains };

const walletConfig: SodaxWalletConfig = {
  EVM: {
    // Hydration-timing flag: defers wagmi's reconnect into useEffect so it does not setState during
    // render. Not "is my host app SSR" — see sodax-sdks issue #129.
    ssr: true,
    chains: walletChains,
    ...(walletConnectProjectId ? { walletConnect: { projectId: walletConnectProjectId } } : {}),
  },
};

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SodaxProvider config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>
        <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}
