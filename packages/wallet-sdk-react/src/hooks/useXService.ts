import type { ChainType } from '@sodax/types';
import type { XService } from '@/core/index.js';
import { useXWalletStore } from '@/useXWalletStore.js';

export type UseXServiceOptions = {
  xChainType?: ChainType;
};

export function useXService({ xChainType }: UseXServiceOptions = {}): XService | undefined {
  const xService = useXWalletStore(state => (xChainType ? state.xServices[xChainType] : undefined));
  return xService;
}
