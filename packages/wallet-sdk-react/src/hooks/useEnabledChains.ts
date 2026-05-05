import type { ChainType } from '@sodax/types';
import { useXWalletStore } from '@/useXWalletStore.js';

/** All chain types currently enabled in `SodaxWalletProvider` config. */
export function useEnabledChains(): ChainType[] {
  return useXWalletStore(state => state.enabledChains);
}
