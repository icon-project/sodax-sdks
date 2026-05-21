import { useEffect, useRef } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import type { WalletName } from '@provablehq/aleo-wallet-standard';
import { useXWalletStore } from '../../useXWalletStore.js';
import { useWalletConfig } from '../../context/WalletConfigContext.js';
import { ALEO_DEFAULT_NETWORK } from '../../constants.js';

// `Network` enum is intentionally not imported — adaptor-react was built
// against a different @provablehq/aleo-types version. We cast the wire-level
// string to `connect()`'s parameter type at the boundary instead.
type AleoConnectNetwork = Parameters<ReturnType<typeof useWallet>['connect']>[0];

// `selectWallet()` is a React setState in adaptor-react. Its `connect`
// callback only closes over the freshly-selected adapter on the next
// render + effect. Poll the ref briefly before calling connect, otherwise
// the adaptor throws WalletNotSelectedError.
const SELECT_WALLET_PROPAGATION_TIMEOUT_MS = 2000;
const SELECT_WALLET_POLL_INTERVAL_MS = 10;

/**
 * Registers Aleo ChainActions into the store.
 *
 * Aleo wallets expose a Promise-based `connect(network)` from `useWallet()` —
 * no event listener gymnastics needed (unlike Solana's MetaMask path). The
 * adapter context resolves the promise after the wallet user accepts.
 */
export const AleoActions = () => {
  const aleoWallet = useWallet();
  const registerChainActions = useXWalletStore(state => state.registerChainActions);
  const walletConfig = useWalletConfig();
  const network = walletConfig.ALEO?.network ?? ALEO_DEFAULT_NETWORK;

  const walletRef = useRef(aleoWallet);
  useEffect(() => {
    walletRef.current = aleoWallet;
  }, [aleoWallet]);

  useEffect(() => {
    registerChainActions('ALEO', {
      connect: async (xConnectorId: string) => {
        const wallet = walletRef.current.wallets.find(w => w.adapter.name === xConnectorId);
        if (!wallet) {
          console.warn(
            `[AleoActions] connect: wallet "${xConnectorId}" not found in adapter list`,
            walletRef.current.wallets.map(w => w.adapter.name),
          );
          return undefined;
        }

        walletRef.current.selectWallet(wallet.adapter.name as WalletName);

        // Already connected (e.g. autoConnect on page refresh) — nothing to do.
        if (wallet.adapter.connected) {
          return undefined;
        }

        const selectionStartedAt = Date.now();
        while (walletRef.current.wallet?.adapter?.name !== xConnectorId) {
          if (Date.now() - selectionStartedAt > SELECT_WALLET_PROPAGATION_TIMEOUT_MS) {
            throw new Error(`Aleo wallet selection did not propagate in time: ${xConnectorId}`);
          }
          await new Promise(resolve => setTimeout(resolve, SELECT_WALLET_POLL_INTERVAL_MS));
        }

        await walletRef.current.connect(network as AleoConnectNetwork);
        return undefined;
      },
      disconnect: async () => {
        await walletRef.current.disconnect();
      },
      getConnectors: () => useXWalletStore.getState().xConnectorsByChain.ALEO ?? [],
      getConnection: () => useXWalletStore.getState().xConnections.ALEO,
      signMessage: async (message: string) => {
        const signature = await walletRef.current.signMessage(message);
        if (!signature) {
          throw new Error('Aleo wallet returned no signature');
        }
        return Buffer.from(signature).toString('base64');
      },
    });
  }, [registerChainActions, network]);

  return null;
};
