import type { ChainType } from '@sodax/types';
import type { IXConnector } from '@/types/interfaces.js';
import { useXWalletStore } from '@/useXWalletStore.js';

/** Available wallet connectors grouped by chain type. */
export function useXConnectorsByChain(): Partial<Record<ChainType, IXConnector[]>> {
  return useXWalletStore(state => state.xConnectorsByChain);
}
