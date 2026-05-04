import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from './useSodaxContext.js';
import type { Address } from 'viem';
import type { ReadHookParams } from './types.js';

export type UseGetUserHubWalletAddressParams = ReadHookParams<
  Address,
  {
    spokeChainId?: SpokeChainKey;
    spokeAddress?: string;
  }
>;

/**
 * Hook for deriving user wallet address for hub abstraction.
 *
 * This hook derives the user's abstracted wallet address for the hub chain based on the spoke chain ID and address.
 * If the spoke chain is the same as the hub chain, it returns the encoded spoke address.
 * Otherwise, it derives and returns the abstracted wallet address for cross-chain operations.
 * NOTE: This hook is different from useDeriveUserWalletAddress because it uses wallet router address instead of CREATE3 address for Sonic (hub).
 *
 * The query is automatically enabled when both `spokeChainId` and `spokeAddress` are provided.
 * This is a deterministic operation, so the result is cached and not refetched automatically.
 *
 * @example
 * ```typescript
 * const { data: derivedAddress, isLoading, error } = useGetUserHubWalletAddress({
 *   params: { spokeChainId, spokeAddress: userAddress },
 * });
 * ```
 */
export function useGetUserHubWalletAddress({
  params,
  queryOptions,
}: UseGetUserHubWalletAddressParams = {}): UseQueryResult<Address, Error> {
  const { sodax } = useSodaxContext();
  const spokeChainId = params?.spokeChainId;
  const spokeAddress = params?.spokeAddress;

  return useQuery<Address, Error>({
    queryKey: ['shared', 'userHubWalletAddress', spokeChainId, spokeAddress],
    queryFn: async (): Promise<Address> => {
      if (!spokeChainId || !spokeAddress) {
        throw new Error('Spoke chain id and address are required');
      }
      return await sodax.hubProvider.getUserHubWalletAddress(spokeAddress, spokeChainId);
    },
    enabled: !!spokeChainId && !!spokeAddress,
    refetchInterval: false,
    ...queryOptions,
  });
}
