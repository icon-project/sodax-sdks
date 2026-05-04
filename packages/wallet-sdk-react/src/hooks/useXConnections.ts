import type { ChainType } from '@sodax/types';
import type { XConnection } from '@/types/index.js';
import { useXWalletStore } from '@/useXWalletStore.js';

export function useXConnections(): Partial<Record<ChainType, XConnection>> {
  return useXWalletStore(state => state.xConnections);
}
