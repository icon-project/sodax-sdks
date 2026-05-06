import { useEffect } from 'react';
import type { ChainType } from '@sodax/types';
import type { SodaxWalletConfig } from '@/types/config.js';
import { useXWalletStore } from '@/useXWalletStore.js';
import { chainRegistry } from '@/chainRegistry.js';
import { reconnectIcon } from '@/xchains/icon/actions.js';
import { reconnectInjective } from '@/xchains/injective/actions.js';
import { reconnectStellar } from '@/xchains/stellar/actions.js';

/**
 * Initializes chain services based on config. Runs once on mount.
 * Config is immutable after initial render — dynamic changes require remounting SodaxWalletProvider.
 * After persist hydration, re-fires setXConnection for every persisted connection so the
 * createWalletProvider side-effect rebuilds walletProviders (which are not persisted).
 */
export function useInitChainServices(walletConfig: SodaxWalletConfig) {
  const initChainServices = useXWalletStore(state => state.initChainServices);
  const cleanupDisabledConnections = useXWalletStore(state => state.cleanupDisabledConnections);

  // biome-ignore lint/correctness/useExhaustiveDependencies: run-once on mount — config is immutable after initial render, dynamic changes require remounting SodaxWalletProvider
  useEffect(() => {
    initChainServices(walletConfig);

    const afterHydration = () => {
      cleanupDisabledConnections();

      const store = useXWalletStore.getState();
      for (const chainType of Object.keys(store.xConnections) as ChainType[]) {
        if (!chainRegistry[chainType]?.createWalletProvider) continue;
        const conn = store.xConnections[chainType];
        if (conn) store.setXConnection(chainType, conn);
      }

      if (walletConfig.ICON) {
        reconnectIcon().catch(error => console.warn('[wallet-sdk-react] ICON reconnect failed:', error));
      }
      if (walletConfig.INJECTIVE) {
        reconnectInjective().catch(error => console.warn('[wallet-sdk-react] Injective reconnect failed:', error));
      }
      if (walletConfig.STELLAR) {
        reconnectStellar().catch(error => console.warn('[wallet-sdk-react] Stellar reconnect failed:', error));
      }
    };

    if (useXWalletStore.persist.hasHydrated()) {
      afterHydration();
    } else {
      useXWalletStore.persist.onFinishHydration(afterHydration);
    }
  }, []);
}
