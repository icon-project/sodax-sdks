import { useEffect, useMemo } from 'react';
import { useConfig, useConnectors, useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import { EvmXService } from '@/xchains/evm/EvmXService.js';
import { EvmXConnector } from '@/xchains/evm/index.js';
import { useXWalletStore } from '@/useXWalletStore.js';
import { useWalletConfig } from '@/context/WalletConfigContext.js';
import { resolveEvmDefaults } from '@/utils/walletRpcConfig.js';

/**
 * Hydrates EVM state from wagmi hooks into EvmXService singleton and store.
 * Runs as a child of WagmiProvider — has access to wagmi context.
 */
export const EvmHydrator = () => {
  const wagmiConfig = useConfig();
  const connectors = useConnectors();
  const { address, status, connector } = useAccount();
  const evmPublicClient = usePublicClient();
  const { data: evmWalletClient } = useWalletClient();
  const setXConnection = useXWalletStore(state => state.setXConnection);
  const unsetXConnection = useXWalletStore(state => state.unsetXConnection);
  const setWalletProvider = useXWalletStore(state => state.setWalletProvider);
  const walletConfig = useWalletConfig();

  // Hydrate wagmiConfig into singleton
  useEffect(() => {
    if (wagmiConfig) {
      EvmXService.getInstance().wagmiConfig = wagmiConfig;
    }
  }, [wagmiConfig]);

  // Hydrate connectors into store (useConnectors is reactive to EIP-6963 discovery)
  const evmConnectors = useMemo(() => connectors.map(c => new EvmXConnector(c)), [connectors]);
  useEffect(() => {
    EvmXService.getInstance().setXConnectors(evmConnectors);
    useXWalletStore.getState().setXConnectors('EVM', evmConnectors);
  }, [evmConnectors]);

  // Hydrate connection state from wagmi `status` — single source of truth.
  // Skip transient ('connecting'/'reconnecting') so we never write half-resolved
  // state. Settled states map directly: 'connected' → set, 'disconnected' → unset.
  // Idempotent — `unsetXConnection` on empty store is a no-op (Immer detects no
  // structural change → no consumer notify, no persist write).
  useEffect(() => {
    if (status === 'connecting' || status === 'reconnecting') return;
    if (status === 'connected' && address && connector) {
      setXConnection('EVM', {
        xAccount: { address: address as string, xChainType: 'EVM' },
        xConnectorId: connector.id,
      });
    } else if (status === 'disconnected') {
      unsetXConnection('EVM');
    }
  }, [address, status, connector, setXConnection, unsetXConnection]);

  // Build the wallet provider for the chain currently bound to the wagmi client.
  // wagmi swaps clients on chain switch → memo re-fires → provider re-instantiates
  // with the matching per-chain defaults. Each instance is single-chain, symmetric
  // with all other chain providers (Solana/Sui/ICON/etc).
  //
  // Memoization also prevents new instances on unrelated parent re-renders —
  // without it, every consumer of useWalletProvider('EVM') would re-render.
  const walletProvider = useMemo(() => {
    if (!evmPublicClient || !evmWalletClient) return undefined;
    const defaults = resolveEvmDefaults(evmWalletClient.chain.id, walletConfig.EVM?.chains);
    return new EvmWalletProvider({
      walletClient: evmWalletClient,
      publicClient: evmPublicClient,
      defaults,
    });
  }, [evmPublicClient, evmWalletClient, walletConfig.EVM?.chains]);

  useEffect(() => {
    setWalletProvider('EVM', walletProvider);
  }, [walletProvider, setWalletProvider]);

  return null;
};
