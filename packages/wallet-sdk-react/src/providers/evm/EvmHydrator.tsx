import { useEffect, useMemo, useRef, useState } from 'react';
import { useConfig, useConnectors, useAccount, usePublicClient, useWalletClient, useReconnect } from 'wagmi';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import { EvmXService } from '@/xchains/evm/EvmXService.js';
import { EvmXConnector } from '@/xchains/evm/index.js';
import { useXWalletStore } from '@/useXWalletStore.js';
import { useWalletConfig } from '@/context/WalletConfigContext.js';
import { resolveEvmDefaults } from '@/utils/walletRpcConfig.js';

export const EvmHydrator = () => {
  const wagmiConfig = useConfig();
  const connectors = useConnectors();
  const { address, status, connector } = useAccount();
  const evmPublicClient = usePublicClient();
  const { data: evmWalletClient } = useWalletClient();
  const setXConnection = useXWalletStore(state => state.setXConnection);
  const unsetXConnection = useXWalletStore(state => state.unsetXConnection);
  const setWalletProvider = useXWalletStore(state => state.setWalletProvider);
  const userDisconnectedEvm = useXWalletStore(state => state.userDisconnected.EVM);
  const { reconnect } = useReconnect();
  const walletConfig = useWalletConfig();

  useEffect(() => {
    if (wagmiConfig) {
      EvmXService.getInstance().wagmiConfig = wagmiConfig;
    }
  }, [wagmiConfig]);

  const evmConnectors = useMemo(() => connectors.map(c => new EvmXConnector(c)), [connectors]);
  useEffect(() => {
    EvmXService.getInstance().setXConnectors(evmConnectors);
    useXWalletStore.getState().setXConnectors('EVM', evmConnectors);
  }, [evmConnectors]);

  // Retry reconnect when new connectors announce (Hana lazy-announces post-mount) or
  // when status settles to 'disconnected' with a persisted connection. wagmi's
  // `Hydrate.onMount()` only runs once and won't retry on its own.
  // `hydrated` gates retry until persist rehydration so `xConnections.EVM` and
  // `userDisconnected.EVM` reads are authoritative.
  const [hydrated, setHydrated] = useState(() => useXWalletStore.persist.hasHydrated());
  useEffect(() => {
    if (hydrated) return;
    const unsub = useXWalletStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, [hydrated]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `connectors` is a re-fire trigger only — wagmi mipd appends new connectors when wallets announce post-mount, and we want to retry reconnect each time the list grows
  useEffect(() => {
    if (!hydrated) return;
    if (status !== 'disconnected') return;
    const state = useXWalletStore.getState();
    if (!state.xConnections.EVM) return;
    if (state.userDisconnected.EVM) return;
    reconnect();
  }, [hydrated, connectors, status, reconnect]);

  // wasConnectedRef: ignore the initial 'disconnected' tick before wagmi reconnects.
  // evmWalletClient gate: status flips sync but walletClient is async — wait so
  // xConnection and walletProvider stay in sync.
  // userDisconnectedEvm gate: ignore ghost reconnects when a wallet refuses
  // `wallet_revokePermissions`.
  const wasConnectedRef = useRef(false);
  useEffect(() => {
    if (status === 'connecting' || status === 'reconnecting') return;
    if (status === 'connected' && address && connector && evmWalletClient) {
      if (userDisconnectedEvm) return;
      wasConnectedRef.current = true;
      setXConnection('EVM', {
        xAccount: { address: address as string, xChainType: 'EVM' },
        xConnectorId: connector.id,
      });
    } else if (status === 'disconnected' && wasConnectedRef.current) {
      wasConnectedRef.current = false;
      unsetXConnection('EVM');
    }
  }, [address, status, connector, evmWalletClient, userDisconnectedEvm, setXConnection, unsetXConnection]);

  const walletProvider = useMemo(() => {
    if (!evmPublicClient || !evmWalletClient) return undefined;
    if (userDisconnectedEvm) return undefined;
    const defaults = resolveEvmDefaults(evmWalletClient.chain.id, walletConfig.EVM?.chains);
    return new EvmWalletProvider({
      walletClient: evmWalletClient,
      publicClient: evmPublicClient,
      defaults,
    });
  }, [evmPublicClient, evmWalletClient, walletConfig.EVM?.chains, userDisconnectedEvm]);

  useEffect(() => {
    setWalletProvider('EVM', walletProvider);
  }, [walletProvider, setWalletProvider]);

  return null;
};
