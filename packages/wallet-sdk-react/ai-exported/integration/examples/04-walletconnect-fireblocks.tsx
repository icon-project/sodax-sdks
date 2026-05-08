/**
 * WalletConnect setup filtered to Fireblocks only.
 * For dApps that target enterprise custody users.
 *
 * Get a projectId at https://cloud.walletconnect.com
 * Find Fireblocks wallet id at https://walletconnect.com/explorer
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SodaxWalletProvider,
  type SodaxWalletConfig,
  useWalletModal,
  useXConnectors,
  useXAccount,
  useXDisconnect,
} from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';

const queryClient = new QueryClient();

// Fireblocks wallet id from https://walletconnect.com/explorer
const FIREBLOCKS_WALLET_ID = '225affb176778569276e484e1b92637ad061b01e13a048b35a9d280c3b58970f';

const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://ethereum-rpc.publicnode.com' },
      [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://arb1.arbitrum.io/rpc' },
    },
    walletConnect: {
      projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? '',
      qrModalOptions: {
        explorerRecommendedWalletIds: [FIREBLOCKS_WALLET_ID],
        explorerExcludedWalletIds: 'ALL', // hide everything except recommended
      },
    },
  },
};

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SodaxWalletProvider config={walletConfig}>
        <ConnectFireblocks />
      </SodaxWalletProvider>
    </QueryClientProvider>
  );
}

function ConnectFireblocks() {
  const modal = useWalletModal();
  const connectors = useXConnectors({ xChainType: 'EVM' });
  const account = useXAccount({ xChainType: 'EVM' });
  const disconnect = useXDisconnect();

  const wcConnector = connectors.find((c) => c.id === 'walletConnect');

  // Hide the modal while wagmi/WalletConnect's QR modal owns the screen
  if (modal.state.kind === 'connecting' && modal.state.connector.id === 'walletConnect') {
    return null;
  }

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

  if (!wcConnector) {
    return <p>WalletConnect not configured — set NEXT_PUBLIC_WC_PROJECT_ID</p>;
  }

  return (
    <button type="button" onClick={() => modal.selectWallet(wcConnector)}>
      Connect with Fireblocks
    </button>
  );
}
