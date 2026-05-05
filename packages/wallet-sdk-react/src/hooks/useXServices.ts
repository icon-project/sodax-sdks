import type { ChainType } from '@sodax/types';
import type { XService } from '@/core/index.js';
import { useXWalletStore } from '@/useXWalletStore.js';

/** Registered chain services keyed by chain type. */
export function useXServices(): Partial<Record<ChainType, XService>> {
  return useXWalletStore(state => state.xServices);
}
