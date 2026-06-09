import { ChainKeys, type SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from './useSodaxContext.js';
import type { ReadHookParams } from './types.js';

export type UseNearStorageCheckParams = ReadHookParams<
  boolean,
  {
    token: string | undefined;
    accountId: string | undefined;
    chainId: SpokeChainKey | undefined;
  }
>;

/**
 * Whether `accountId` is NEP-141 storage-registered for `token` on NEAR — the receive-side
 * prerequisite for any leg that delivers a token to the user on NEAR (swap output on NEAR, bridge
 * into NEAR, money-market borrow/withdraw to NEAR). NEAR's analogue of a Stellar trustline.
 *
 * Returns `true` (no gate) when `chainId` is not NEAR, mirroring how the Stellar trustline check
 * short-circuits off-chain. Native NEAR is not a NEP-141 token, so the SDK reports it as registered.
 *
 * Pair with {@link useRegisterNearStorage} to perform the one-time `storage_deposit` when this
 * resolves to `false`.
 */
export function useNearStorageCheck({
  params,
  queryOptions,
}: UseNearStorageCheckParams = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  const token = params?.token;
  const accountId = params?.accountId;
  const chainId = params?.chainId;

  return useQuery<boolean, Error>({
    queryKey: ['shared', 'nearStorageCheck', token, accountId],
    queryFn: async () => {
      if (chainId !== ChainKeys.NEAR_MAINNET) return true;
      if (!token || !accountId) return false;
      return sodax.spoke.near.isStorageRegistered(token, accountId);
    },
    enabled: !!token && !!accountId,
    ...queryOptions,
  });
}
