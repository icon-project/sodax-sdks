import type { ChainType } from '@sodax/types';
import type { XService } from '@/core/index.js';
import { useXWalletStore } from '@/useXWalletStore.js';

export function useXServices(): Partial<Record<ChainType, XService>> {
  return useXWalletStore(state => state.xServices);
}
