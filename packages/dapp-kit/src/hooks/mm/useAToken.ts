import type { Erc20Token } from '@sodax/sdk';
import type { ChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { type Address, isAddress } from 'viem';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type ATokenData = Erc20Token & { chainKey: ChainKey };

export type UseATokenParams = ReadHookParams<
  ATokenData,
  {
    aToken: Address | string | undefined;
  }
>;

/**
 * React hook to fetch ERC-20 metadata for a given aToken address on the hub chain.
 * Returns `Erc20Token` (`name`, `symbol`, `decimals`, `address`) augmented with the hub
 * `chainKey`. Note: the returned shape is a subset of `XToken` — `hubAsset` and `vault` fields
 * must be resolved separately if needed.
 */
export function useAToken({ params, queryOptions }: UseATokenParams = {}): UseQueryResult<ATokenData, Error> {
  const { sodax } = useSodaxContext();
  const aToken = params?.aToken;

  return useQuery({
    queryKey: ['mm', 'aToken', aToken],
    queryFn: async () => {
      if (!aToken) {
        throw new Error('aToken address is required');
      }
      if (!isAddress(aToken)) {
        throw new Error('aToken address is not a valid address');
      }

      const aTokenData = await sodax.moneyMarket.data.getATokenData(aToken);
      return {
        ...aTokenData,
        chainKey: sodax.hubProvider.chainConfig.chain.key,
      };
    },
    enabled: !!aToken && isAddress(aToken ?? ''),
    ...queryOptions,
  });
}
