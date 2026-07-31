import { useEffect, useMemo, useRef } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { AleoWalletProvider as CoreAleoWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys } from '@sodax/types';
import { AleoXService } from '../../xchains/aleo/AleoXService.js';
import { AleoXConnector } from '../../xchains/aleo/AleoXConnector.js';
import { useXWalletStore } from '../../useXWalletStore.js';
import { useWalletConfig } from '../../context/WalletConfigContext.js';
import { getEntryDefaults, getRpcUrl } from '../../utils/walletRpcConfig.js';
import { ALEO_DEFAULT_RPC_URL } from '../../constants.js';

/**
 * Hydrates Aleo state from @provablehq/aleo-wallet-adaptor-react into the
 * AleoXService singleton and the Zustand store. Sole writer of `xConnections.ALEO`
 * and `walletProviders.ALEO`.
 */
export const AleoHydrator = () => {
  const aleoWallet = useWallet();
  const setXConnection = useXWalletStore(state => state.setXConnection);
  const unsetXConnection = useXWalletStore(state => state.unsetXConnection);
  const setWalletProvider = useXWalletStore(state => state.setWalletProvider);
  const walletConfig = useWalletConfig();

  const rpcUrl = getRpcUrl(walletConfig.ALEO?.chains?.[ChainKeys.ALEO_MAINNET]) ?? ALEO_DEFAULT_RPC_URL;
  const aleoDefaults = getEntryDefaults<typeof ChainKeys.ALEO_MAINNET>(
    walletConfig.ALEO?.chains?.[ChainKeys.ALEO_MAINNET],
  );

  // Keep the service's RPC in sync with config.
  useEffect(() => {
    AleoXService.getInstance().setRpcUrl(rpcUrl);
  }, [rpcUrl]);

  // useWallet() returns a new object ref every render — keep a ref so effects
  // can read the full object without listing it as a dep.
  const aleoWalletRef = useRef(aleoWallet);
  useEffect(() => {
    aleoWalletRef.current = aleoWallet;
  });

  // Memoize installed connectors. aleoWallet.wallets is an unstable array reference,
  // but we only care about the installed subset and stable adapter identity.
  const aleoConnectors = useMemo(
    () =>
      aleoWallet.wallets
        .filter(wallet => (wallet.readyState as string) === 'Installed')
        .map(wallet => new AleoXConnector(wallet)),
    [aleoWallet.wallets],
  );

  useEffect(() => {
    AleoXService.getInstance().setXConnectors(aleoConnectors);
    useXWalletStore.getState().setXConnectors('ALEO', aleoConnectors);
  }, [aleoConnectors]);

  const wasConnectedRef = useRef(!!useXWalletStore.getState().xConnections.ALEO);
  useEffect(() => {
    if (aleoWallet.connected && aleoWallet.address) {
      wasConnectedRef.current = true;
      setXConnection('ALEO', {
        xAccount: { address: aleoWallet.address, xChainType: 'ALEO' },
        xConnectorId: `${aleoWallet.wallet?.adapter.name}`,
      });
    } else if (wasConnectedRef.current) {
      wasConnectedRef.current = false;
      unsetXConnection('ALEO');
    }
  }, [aleoWallet.connected, aleoWallet.address, aleoWallet.wallet, setXConnection, unsetXConnection]);

  // Construct the core wallet provider when an adapter is connected. Must wait
  // for `address` so `getWalletAddress()` works without re-entering the connect
  // path. Use the adapter directly (not a ref) so memo deps are stable.
  const walletProvider = useMemo(() => {
    if (aleoWallet.connected && aleoWallet.address && aleoWallet.wallet?.adapter) {
      return new CoreAleoWalletProvider({
        type: 'browserExtension',
        rpcUrl,
        provableAdapter: aleoWallet.wallet.adapter,
        network: walletConfig.ALEO?.network ?? 'mainnet',
        defaults: aleoDefaults,
      });
    }
    return undefined;
  }, [aleoWallet.connected, aleoWallet.address, aleoWallet.wallet, rpcUrl, walletConfig.ALEO?.network, aleoDefaults]);

  useEffect(() => {
    setWalletProvider('ALEO', walletProvider);
  }, [walletProvider, setWalletProvider]);

  return null;
};
