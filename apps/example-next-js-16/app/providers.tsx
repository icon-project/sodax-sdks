'use client';

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { SodaxProvider } from '@sodax/dapp-kit';
import { ChainKeys, type DeepPartial, type SodaxConfig } from '@sodax/sdk';
import type { State as WagmiState } from 'wagmi';

const queryClient = new QueryClient();

// Public RPC is the default to keep `pnpm verify` work for ad-hoc local runs,
// but CI overrides via `SONIC_RPC_URL` to swap in a higher-quota endpoint
// (rate-limit on `rpc.soniclabs.com` has bitten preview deploys before).
const SONIC_RPC = process.env.SONIC_RPC_URL ?? 'https://rpc.soniclabs.com';

const sodaxConfig: DeepPartial<SodaxConfig> = {
  chains: {
    [ChainKeys.SONIC_MAINNET]: { rpcUrl: SONIC_RPC },
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
