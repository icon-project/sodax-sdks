import type { IStellarWalletProvider, StellarChainKey } from '@sodax/sdk';
import { ChainKeys } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import type { MutationHookParams } from './types.js';
import { useSafeMutation, type SafeUseMutationResult } from './useSafeMutation.js';
import { useSodaxContext } from './useSodaxContext.js';

export type UseRequestTrustlineVars = {
  token: string;
  amount: bigint;
  srcChainKey: StellarChainKey;
  walletProvider: IStellarWalletProvider;
};

/**
 * Establish a Stellar trustline. The account pays its fee and reserve; use
 * {@link useStellarGate} to verify it can afford them.
 */
export function useRequestTrustline({
  mutationOptions,
}: MutationHookParams<string, UseRequestTrustlineVars> = {}): SafeUseMutationResult<
  string,
  Error,
  UseRequestTrustlineVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<string, Error, UseRequestTrustlineVars>({
    mutationKey: ['shared', 'requestTrustline'],
    ...mutationOptions,
    mutationFn: async ({ token, amount, srcChainKey, walletProvider }): Promise<string> => {
      const srcAddress = await walletProvider.getWalletAddress();
      return sodax.spoke.stellar.requestTrustline<false>({
        raw: false,
        srcChainKey,
        srcAddress,
        token,
        amount,
        walletProvider,
      });
    },
    onSuccess: async (data, vars, ctx) => {
      // The trustline is already broadcast here, so a wallet that locks or switches
      // accounts mid-flow must not turn success into an error — nor skip the
      // invalidations below, which is what an unguarded throw would do.
      const srcAddress = await vars.walletProvider.getWalletAddress().catch(() => undefined);
      // Without the address, invalidate the whole prefix rather than nothing.
      queryClient.invalidateQueries({
        queryKey: srcAddress
          ? ['shared', 'stellarTrustlineCheck', vars.srcChainKey, vars.token, srcAddress]
          : ['shared', 'stellarTrustlineCheck'],
      });
      // A new trustline changes spendable XLM for subsequent trustlines.
      queryClient.invalidateQueries({
        queryKey: srcAddress ? ['sponsoring', 'stellarAccountStatus', srcAddress] : ['sponsoring', 'stellarAccountStatus'],
      });
      queryClient.invalidateQueries({ queryKey: ['shared', 'xBalances', ChainKeys.STELLAR_MAINNET] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
