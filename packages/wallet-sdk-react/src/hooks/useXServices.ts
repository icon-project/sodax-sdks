import type { ChainType } from '@sodax/types';
import type { XService } from '@/core/index.js';
import { useXWalletStore } from '@/useXWalletStore.js';

/**
 * Returns the `XService` instance for every enabled chain, keyed by `ChainType`.
 *
 * Each service singleton owns its connector list and exposes balance readers; concrete
 * subclasses (e.g. `EvmXService`, `BitcoinXService`) carry chain-specific methods. For
 * a single chain, prefer `useXService` which is keyed by `xChainType` directly.
 */
export function useXServices(): Partial<Record<ChainType, XService>> {
  return useXWalletStore(state => state.xServices);
}
