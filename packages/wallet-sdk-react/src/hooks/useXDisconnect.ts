import type { ChainType } from '@sodax/types';
import { useCallback } from 'react';
import { useXWalletStore } from '@/useXWalletStore.js';

export type UseXDisconnectArgs = {
  xChainType: ChainType;
};

/**
 * Hook for disconnecting from a specific blockchain wallet.
 *
 * All chains delegate to ChainActions registered in the store.
 */
export function useXDisconnect(): (args: UseXDisconnectArgs) => Promise<void> {
  const actionsRegistry = useXWalletStore(state => state.chainActions);

  return useCallback(
    async ({ xChainType }: UseXDisconnectArgs) => {
      const chainActions = actionsRegistry[xChainType];
      if (chainActions) {
        await chainActions.disconnect();
      } else {
        console.warn(
          `[useXDisconnect] No chain actions registered for "${xChainType}". Is it enabled in config.chains?`,
        );
      }
    },
    [actionsRegistry],
  );
}
