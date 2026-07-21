import { ChainKeys, type SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from './useSodaxContext.js';
import type { ReadHookParams } from './types.js';
import { unwrapResult } from './unwrapResult.js';

export type UseStellarAccountCheckParams = ReadHookParams<
  boolean,
  {
    address: string | undefined;
    chainId: SpokeChainKey | undefined;
  }
>;

/**
 * Whether `address` exists on the Stellar ledger (has been activated). A Stellar address only
 * becomes a receivable account after it has been funded/created on ledger, so this is the
 * receive-side prerequisite for any leg that delivers a token to the user on Stellar — checked
 * before (and in addition to) the trustline via {@link useStellarTrustlineCheck}.
 *
 * Returns `true` (no gate) when `chainId` is not Stellar, mirroring how the trustline check
 * short-circuits off-chain.
 *
 * Pair with {@link useSponsorStellarAccount} to create the account (sponsored, zero starting
 * balance) when this resolves to `false`.
 */
export function useStellarAccountCheck({
  params,
  queryOptions,
}: UseStellarAccountCheckParams = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  const address = params?.address;
  const chainId = params?.chainId;

  return useQuery<boolean, Error>({
    queryKey: ['shared', 'stellarAccountCheck', chainId, address],
    queryFn: async () => {
      if (chainId !== ChainKeys.STELLAR_MAINNET) return true;
      if (!address) return false;
      return unwrapResult(await sodax.spoke.stellar.hasValidStellarAccount(address));
    },
    enabled: !!address,
    ...queryOptions,
  });
}
