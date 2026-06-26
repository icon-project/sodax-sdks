import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChainKeys } from '@sodax/types';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { type ReactNode, useMemo } from 'react';

const queryClient = new QueryClient();

export default function Providers({ children }: { children: ReactNode }) {
  const walletConfig = useMemo((): SodaxWalletConfig => {
    const wcProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
    return {
      EVM: {
        // Defer wagmi reconnect into useEffect to avoid a setState-during-render warning.
        ssr: true,
        reconnectOnMount: true,
        walletConnect: wcProjectId ? { projectId: wcProjectId } : undefined,
        chains: {
          [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://sonic-rpc.publicnode.com' },
          [ChainKeys.AVALANCHE_MAINNET]: { rpcUrl: 'https://avalanche-c-chain-rpc.publicnode.com' },
          [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://base.drpc.org' },
          [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc.drpc.org' },
          [ChainKeys.OPTIMISM_MAINNET]: { rpcUrl: 'https://optimism-rpc.publicnode.com' },
          [ChainKeys.POLYGON_MAINNET]: { rpcUrl: 'https://polygon-bor-rpc.publicnode.com' },
          [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://ethereum-rpc.publicnode.com' },
          [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://arbitrum-one-rpc.publicnode.com' },
        },
      },
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
    </QueryClientProvider>
  );
}
