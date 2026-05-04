import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from './useSodaxContext.js';
import type { Address } from 'viem';
import type { ReadHookParams } from './types.js';

export type UseDeriveUserWalletAddressParams = ReadHookParams<
  Address,
  {
    spokeChainId?: SpokeChainKey;
    spokeAddress?: string;
  }
>;

export function useDeriveUserWalletAddress({
  params,
  queryOptions,
}: UseDeriveUserWalletAddressParams = {}): UseQueryResult<Address, Error> {
  const { sodax } = useSodaxContext();
  const spokeChainId = params?.spokeChainId;
  const spokeAddress = params?.spokeAddress;

  return useQuery<Address, Error>({
    queryKey: ['shared', 'deriveUserWalletAddress', spokeChainId, spokeAddress],
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
