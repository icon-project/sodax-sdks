import type { ChainType } from '@sodax/types';
import { useXWalletStore } from '@/useXWalletStore.js';

export function useEnabledChains(): ChainType[] {
  return useXWalletStore(state => state.enabledChains);
}
