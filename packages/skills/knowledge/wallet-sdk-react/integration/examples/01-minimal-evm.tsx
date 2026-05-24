/**
 * Minimal EVM setup — provider + single connect button.
 * Smallest working integration of @sodax/wallet-sdk-react.
 *
 * Run: drop this file in a Vite/CRA app, render <App /> at the root.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SodaxWalletProvider,
  type SodaxWalletConfig,
  useXAccount,
  useXConnect,
  useXConnectors,
  useXDisconnect,
} from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';

// Module-level constants — never recreate these inside a component.
const queryClient = new QueryClient();

const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: false,
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://ethereum-rpc.publicnode.com' },
      [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc-dataseed.binance.org' },
    },
  },
};

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SodaxWalletProvider config={walletConfig}>
        <ConnectButton />
      </SodaxWalletProvider>
    </QueryClientProvider>
  );
}

function ConnectButton() {
  const connectors = useXConnectors({ xChainType: 'EVM' });
  const { mutateAsync: connect, isPending } = useXConnect();
  const account = useXAccount({ xChainType: 'EVM' });
  const disconnect = useXDisconnect();

  if (account.address) {
    return (
      <div>
        <code>{account.address}</code>
        <button type="button" onClick={() => disconnect({ xChainType: 'EVM' })}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div>
      {connectors.map((connector) => (
        <button
          type="button"
          key={connector.id}
          onClick={() => connect(connector).catch(() => {})}
          disabled={isPending || !connector.isInstalled}
        >
          {connector.name}
          {!connector.isInstalled && ' (not installed)'}
        </button>
      ))}
    </div>
  );
}
