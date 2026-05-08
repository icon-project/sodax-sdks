/**
 * Multi-chain headless wallet modal.
 * Renders chain picker → wallet picker → connecting → success/error using `useWalletModal`.
 *
 * UI uses native <dialog> — replace with shadcn/Radix/your dialog primitive.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SodaxWalletProvider,
  type SodaxWalletConfig,
  useWalletModal,
  useChainGroups,
  sortConnectors,
  type IXConnector,
} from '@sodax/wallet-sdk-react';
import type { ChainType } from '@sodax/types';
import { ChainKeys } from '@sodax/types';

const queryClient = new QueryClient();

const walletConfig: SodaxWalletConfig = {
  EVM: {
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://ethereum-rpc.publicnode.com' },
    },
  },
  SOLANA: {
    chains: { [ChainKeys.SOLANA_MAINNET]: { rpcUrl: 'https://api.mainnet-beta.solana.com' } },
  },
  SUI: { network: 'mainnet' },
  BITCOIN: {},
  ICON: {
    chains: { [ChainKeys.ICON_MAINNET]: { rpcUrl: 'https://ctz.solidwallet.io/api/v3' } },
  },
};

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SodaxWalletProvider config={walletConfig}>
        <WalletModalRoot />
      </SodaxWalletProvider>
    </QueryClientProvider>
  );
}

function WalletModalRoot() {
  const modal = useWalletModal({
    onConnected: (chainType, account) => {
      console.log('connected', chainType, account.address);
    },
  });

  switch (modal.state.kind) {
    case 'closed':
      return (
        <button type="button" onClick={modal.open}>
          Connect Wallet
        </button>
      );

    case 'chainSelect':
      return <ChainPicker onPick={modal.selectChain} onClose={modal.close} />;

    case 'walletSelect':
      return (
        <WalletPicker
          chainType={modal.state.chainType}
          connectors={modal.state.connectors}
          onPick={modal.selectWallet}
          onBack={modal.back}
          onClose={modal.close}
        />
      );

    case 'connecting':
      // Hide modal while wagmi's QR modal owns the screen for WalletConnect
      if (modal.state.connector.id === 'walletConnect') return null;
      return (
        <Dialog onClose={modal.close}>
          <p>Approve in {modal.state.connector.name}…</p>
          <button type="button" onClick={modal.back}>
            Cancel
          </button>
        </Dialog>
      );

    case 'error':
      return (
        <Dialog onClose={modal.close}>
          <p>Error: {modal.state.error.message}</p>
          {!modal.state.connector.isInstalled && modal.state.connector.installUrl && (
            <a href={modal.state.connector.installUrl} target="_blank" rel="noreferrer">
              Install {modal.state.connector.name}
            </a>
          )}
          <button type="button" onClick={modal.retry}>
            Retry
          </button>
          <button type="button" onClick={modal.back}>
            Pick another wallet
          </button>
        </Dialog>
      );

    case 'success':
      // onConnected fired; close the modal
      queueMicrotask(modal.close);
      return null;

    default:
      return null;
  }
}

function ChainPicker({ onPick, onClose }: { onPick: (c: ChainType) => void; onClose: () => void }) {
  const groups = useChainGroups({ order: ['EVM', 'SOLANA', 'SUI', 'BITCOIN', 'ICON'] });
  return (
    <Dialog onClose={onClose}>
      <h2>Select a chain</h2>
      {groups.map((group) => (
        <button type="button" key={group.chainType} onClick={() => onPick(group.chainType)}>
          <span>{group.displayName}</span>
          {group.isConnected && ' ✓'}
        </button>
      ))}
    </Dialog>
  );
}

const PREFERRED = ['hana', 'metamask', 'phantom'] as const;

function WalletPicker({
  chainType,
  connectors: rawConnectors,
  onPick,
  onBack,
  onClose,
}: {
  chainType: ChainType;
  connectors: readonly IXConnector[];
  onPick: (c: IXConnector) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const connectors = sortConnectors(rawConnectors, { preferred: PREFERRED });
  return (
    <Dialog onClose={onClose}>
      <button type="button" onClick={onBack}>
        ← Back
      </button>
      <h2>Connect to {chainType}</h2>
      {connectors.map((connector) => (
        <button
          type="button"
          key={connector.id}
          onClick={() => onPick(connector)}
          disabled={!connector.isInstalled}
        >
          {connector.name}
          {!connector.isInstalled && ' (not installed)'}
        </button>
      ))}
    </Dialog>
  );
}

function Dialog({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <dialog open onClose={onClose} style={{ padding: 16 }}>
      {children}
    </dialog>
  );
}
