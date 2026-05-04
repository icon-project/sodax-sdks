import { type ReactNode, useMemo, useRef } from 'react';
import { WagmiProvider } from 'wagmi';
import { walletConnect } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createWagmiConfig } from '@/xchains/evm/EvmXService.js';
import type { EvmTypeConfig } from '@/types/config.js';
import { EvmHydrator } from './EvmHydrator.js';
import { EvmActions } from './EvmActions.js';
import { EVM_DEFAULT_RECONNECT_ON_MOUNT, EVM_DEFAULT_SSR } from '@/constants.js';

type EvmProviderProps = {
  children: ReactNode;
  /** EVM type slot — wagmi adapter settings + nested per-chain entries. */
  config: EvmTypeConfig;
};

export const EvmProvider = ({ children, config }: EvmProviderProps) => {
  const reconnectOnMount = config.reconnectOnMount ?? EVM_DEFAULT_RECONNECT_ON_MOUNT;
  const ssr = config.ssr ?? EVM_DEFAULT_SSR;

  const queryClientRef = useRef<QueryClient>(null);
  if (!queryClientRef.current) {
    queryClientRef.current = new QueryClient();
  }

  const walletConnectConfig = config.walletConnect;

  const wagmiConfig = useMemo(() => {
    const connectors = [];
    if (walletConnectConfig) {
      if (walletConnectConfig.projectId) {
        connectors.push(walletConnect({ showQrModal: true, ...walletConnectConfig }));
      } else {
        console.warn('[wallet-sdk-react] walletConnect.projectId is required — WalletConnect connector skipped.');
      }
    }
    return createWagmiConfig(config.chains, { reconnectOnMount, ssr, connectors });
  }, [config.chains, reconnectOnMount, ssr, walletConnectConfig]);

  // wagmi requires its own QueryClientProvider — this is wagmi-internal, not the app's React Query cache.
  return (
    <QueryClientProvider client={queryClientRef.current}>
      <WagmiProvider reconnectOnMount={reconnectOnMount} config={wagmiConfig} initialState={config.initialState}>
        <EvmHydrator />
        <EvmActions />
        {children}
      </WagmiProvider>
    </QueryClientProvider>
  );
};
