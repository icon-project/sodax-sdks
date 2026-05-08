/**
 * WalletConnect setup — adds the WalletConnect connector to the EVM modal.
 * For dApps that target users on mobile-only or enterprise custody wallets
 * (Ledger Live, Safe, Fireblocks, ...) which cannot install browser extensions.
 *
 * Get a projectId at https://cloud.walletconnect.com
 *
 * To narrow the WalletConnect modal to ONE specific wallet (e.g. an enterprise
 * custody integration), see the commented `qrModalOptions` block below — fill
 * in the target wallet id from https://walletconnect.com/explorer.
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
      // Optional — restrict the WalletConnect QR modal to a specific wallet:
      //
      // qrModalOptions: {
      //   explorerRecommendedWalletIds: ['<target-wallet-id-from-walletconnect-explorer>'],
      //   explorerExcludedWalletIds: 'ALL', // hide everything except recommended
      // },
    },
  },
};

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SodaxWalletProvider config={walletConfig}>
        <ConnectWithWalletConnect />
      </SodaxWalletProvider>
    </QueryClientProvider>
  );
}

function ConnectWithWalletConnect() {
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
      Connect via WalletConnect
    </button>
  );
}
