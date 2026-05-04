import { createContext, useContext } from 'react';
import type { ChainType } from '@sodax/types';
import type { SodaxWalletConfig } from '@/types/config.js';

/**
 * Config-level context — answers "what did the consumer configure?" (before service init).
 * For service-level queries (is a chain's XService initialized?), use `state.enabledChains` from useXWalletStore.
 * Both sources agree in practice since they're populated from the same config at the same time.
 */
const WalletConfigContext = createContext<SodaxWalletConfig | null>(null);

export const WalletConfigProvider = WalletConfigContext.Provider;

export function useWalletConfig(): SodaxWalletConfig {
  const config = useContext(WalletConfigContext);
  if (!config) {
    throw new Error('useWalletConfig must be used within SodaxWalletProvider');
  }
  return config;
}

/** A chain type is "enabled" only when its slot is present in SodaxWalletConfig. */
export function useIsChainEnabled(chainType: ChainType): boolean {
  const config = useWalletConfig();
  return config[chainType] !== undefined;
}

/** See {@link useIsChainEnabled} for the "enabled" semantic. */
export function useEnabledChainTypes(): ChainType[] {
  const config = useWalletConfig();
  return (Object.keys(config) as ChainType[]).filter(t => config[t] !== undefined);
}
