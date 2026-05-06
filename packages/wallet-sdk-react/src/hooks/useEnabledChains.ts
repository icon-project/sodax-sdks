import type { ChainType } from '@sodax/types';
import { useXWalletStore } from '@/useXWalletStore.js';

/**
 * Reads the list of `ChainType`s currently enabled in `SodaxWalletProvider` config.
 *
 * Reflects which chain-type slots are present (`config.EVM`, `config.SOLANA`, …) — not
 * which chains have a wallet connected. Use `useConnectedChains` for the latter.
 *
 * @returns Stable array reference; re-renders only when `enabledChains` changes (i.e. on
 * `initChainServices` after mount, never afterwards because config is captured once).
 */
export function useEnabledChains(): ChainType[] {
  return useXWalletStore(state => state.enabledChains);
}
