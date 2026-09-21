import { ChainKeys, type Sodax, type SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from './useSodaxContext.js';
import type { ReadHookParams } from './types.js';

export type UseStellarTrustlineCheckParams = ReadHookParams<
  boolean,
  {
    token: string | undefined;
    amount: bigint | undefined;
    chainId: SpokeChainKey | undefined;
    /** Resolved Stellar account address (e.g. `useXAccount('STELLAR').address`) — keys the cache per account. */
    walletAddress: string | undefined;
  }
>;

// Narrow slice of the SDK this query reads — lets tests pass a minimal stub without casting `Sodax`.
type StellarTrustlineReader = { spoke: { stellar: Pick<Sodax['spoke']['stellar'], 'hasSufficientTrustline'> } };

// Pure query options, extracted for unit testing (mirrors `getXBalancesQueryOptions`).
export function getStellarTrustlineCheckQueryOptions({
  sodax,
  token,
  amount,
  chainId,
  walletAddress,
}: {
  sodax: StellarTrustlineReader;
  token: string | undefined;
  amount: bigint | undefined;
  chainId: SpokeChainKey | undefined;
  walletAddress: string | undefined;
}) {
  return {
    // Key on chain, token, account, amount so editing the amount (or switching account/chain) re-queries.
    queryKey: ['shared', 'stellarTrustlineCheck', chainId, token, walletAddress, amount?.toString()] as const,
    queryFn: async (): Promise<boolean> => {
      if (chainId !== ChainKeys.STELLAR_MAINNET) return true;
      if (!walletAddress || !token || !amount) return false;
      return sodax.spoke.stellar.hasSufficientTrustline(token, amount, walletAddress);
    },
    enabled: !!walletAddress && !!token && !!amount,
  };
}

export function useStellarTrustlineCheck({
  params,
  queryOptions,
}: UseStellarTrustlineCheckParams = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  return useQuery<boolean, Error>({
    ...getStellarTrustlineCheckQueryOptions({
      sodax,
      token: params?.token,
      amount: params?.amount,
      chainId: params?.chainId,
      walletAddress: params?.walletAddress,
    }),
    ...queryOptions,
  });
}
