import { ChainKeys, type IStellarWalletProvider, type SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from './useSodaxContext.js';
import type { ReadHookParams } from './types.js';

export type UseStellarTrustlineCheckParams = ReadHookParams<
  boolean,
  {
    token: string | undefined;
    amount: bigint | undefined;
    chainId: SpokeChainKey | undefined;
    walletProvider: IStellarWalletProvider | undefined;
  }
>;

export function useStellarTrustlineCheck({
  params,
  queryOptions,
}: UseStellarTrustlineCheckParams = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  const token = params?.token;
  const amount = params?.amount;
  const chainId = params?.chainId;
  const walletProvider = params?.walletProvider;

  return useQuery<boolean, Error>({
    queryKey: ['stellar-trustline-check', token],
    queryFn: async () => {
      if (chainId !== ChainKeys.STELLAR_MAINNET) return true;
      if (!walletProvider || !token || !amount) return false;
      const walletAddress = await walletProvider.getWalletAddress();
      return sodax.spokeService.stellarSpokeService.hasSufficientTrustline(token, amount, walletAddress);
    },
    enabled: !!walletProvider && !!token && !!amount,
    ...queryOptions,
  });
}
