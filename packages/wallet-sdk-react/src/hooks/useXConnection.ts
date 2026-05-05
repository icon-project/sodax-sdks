import type { ChainType } from '@sodax/types';
import type { XConnection } from '@/types/index.js';
import { useXWalletStore } from '@/useXWalletStore.js';

export type UseXConnectionOptions = {
  xChainType?: ChainType;
};

export function useXConnection({ xChainType }: UseXConnectionOptions = {}): XConnection | undefined {
  return useXWalletStore(state => (xChainType ? state.xConnections?.[xChainType] : undefined));
}
