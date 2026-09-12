import { SodaxProvider, type SodaxOptions, createSodaxQueryClient } from '@sodax/dapp-kit';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { swapsApiKey, walletConnectProjectId } from './config';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';

const queryClient = createSodaxQueryClient();

// SodaxProvider freezes its config by reference on first render, so this stays a module constant.
const sodaxConfig: SodaxOptions = swapsApiKey ? { apiKey: swapsApiKey } : {};

const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    reconnectOnMount: false,
    ...(walletConnectProjectId ? { walletConnect: { projectId: walletConnectProjectId } } : {}),
  },
  SOLANA: { autoConnect: false },
  SUI: { autoConnect: false },
};

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SodaxProvider config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>
        <SodaxWalletProvider config={walletConfig}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}
