import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { ChainType } from '@sodax/types';
import { useXWalletStore } from '@/useXWalletStore.js';

type SignMessageReturnType = `0x${string}` | Uint8Array | string | undefined;

export type XSignMessageVariables = {
  xChainType: ChainType;
  message: string;
};

/**
 * Hook for signing messages across different chains.
 *
 * All chains delegate to ChainActions.signMessage registered in the store.
 */
export function useXSignMessage(): UseMutationResult<
  SignMessageReturnType,
  Error,
  XSignMessageVariables,
  unknown
> {
  const actionsRegistry = useXWalletStore(state => state.chainActions);

  return useMutation({
    mutationFn: async ({ xChainType, message }: XSignMessageVariables) => {
      const chainActions = actionsRegistry[xChainType];
      if (!chainActions?.signMessage) {
        console.warn(`[useXSignMessage] signMessage not supported for chain "${xChainType}"`);
        return undefined;
      }
      return await chainActions.signMessage(message);
    },
  });
}
