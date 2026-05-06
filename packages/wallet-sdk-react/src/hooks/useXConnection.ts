import type { ChainType } from '@sodax/types';
import type { XConnection } from '@/types/index.js';
import { useXWalletStore } from '@/useXWalletStore.js';

export type UseXConnectionOptions = {
  xChainType?: ChainType;
};

/**
 * Returns the active `XConnection` for a chain type — `{ xAccount, xConnectorId }` —
 * or `undefined` when no wallet is connected.
 *
 * Use this when you need the connector identity (e.g. to label a disconnect button
 * with the wallet name or icon). For just the address, prefer `useXAccount`, which
 * always returns a populated object and saves a null check.
 *
 * Returns `undefined` when `xChainType` is omitted — the field is optional to
 * accommodate consumers that branch on chain availability.
 */
export function useXConnection({ xChainType }: UseXConnectionOptions = {}): XConnection | undefined {
  return useXWalletStore(state => (xChainType ? state.xConnections?.[xChainType] : undefined));
}
