import type { ChainType } from '@sodax/types';
import type { XConnection } from '@/types/index.js';
import { useXWalletStore } from '@/useXWalletStore.js';

/**
 * Returns active wallet connections keyed by `ChainType`.
 *
 * Only chains with a connected wallet have entries — disconnected chains are absent
 * from the map (unlike `useXAccounts`, which always populates every enabled chain).
 *
 * The returned object reference is the persisted `xConnections` slice — stable
 * across re-renders that don't change connection state. Mutate via `useXConnect` /
 * `useXDisconnect`, never directly.
 */
export function useXConnections(): Partial<Record<ChainType, XConnection>> {
  return useXWalletStore(state => state.xConnections);
}
