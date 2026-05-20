'use client';

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { SodaxProvider } from '@sodax/dapp-kit';
import { ChainKeys, type DeepPartial, type SodaxConfig } from '@sodax/sdk';
import type { State as WagmiState } from 'wagmi';

const queryClient = new QueryClient();

const sodaxConfig: DeepPartial<SodaxConfig> = {
  chains: {
    [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
  },
};

export default function Providers({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: WagmiState;
}) {
  const walletConfig: SodaxWalletConfig = {
    EVM: {
      ssr: true,
      reconnectOnMount: true,
      initialState,
    },
    ICON: {},
    SOLANA: {},
    SUI: {},
    BITCOIN: {},
    STELLAR: {},
    INJECTIVE: {},
    NEAR: {},
    STACKS: { chains: { [ChainKeys.STACKS_MAINNET]: 'mainnet' } },
  };

  return (
    <SodaxProvider config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>
        <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}
