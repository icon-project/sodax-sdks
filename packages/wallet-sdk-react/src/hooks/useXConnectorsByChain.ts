import type { ChainType } from '@sodax/types';
import type { IXConnector } from '@/types/interfaces.js';
import { useXWalletStore } from '@/useXWalletStore.js';

/**
 * Returns the connector list for every enabled chain type, grouped by `ChainType`.
 *
 * Used for multi-chain wallet pickers (e.g. listing every available wallet across
 * EVM, Solana, Bitcoin in one render). For a single chain, prefer `useXConnectors`
 * which also emits a one-time warning if the chain isn't enabled.
 *
 * Each connector's `isInstalled` reads `window.*` at access time — values stay
 * fresh through normal React render triggers.
 */
export function useXConnectorsByChain(): Partial<Record<ChainType, IXConnector[]>> {
  return useXWalletStore(state => state.xConnectorsByChain);
}
