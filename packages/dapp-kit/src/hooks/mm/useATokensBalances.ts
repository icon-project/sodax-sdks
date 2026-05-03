import type { SpokeChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { type Address, isAddress } from 'viem';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseATokensBalancesParams = ReadHookParams<
  Map<Address, bigint>,
  {
    aTokens: readonly Address[];
    spokeChainKey: SpokeChainKey | undefined;
    userAddress: string | undefined;
  }
>;

/**
 * React hook to fetch aToken balances for a list of addresses in a single multicall.
 * Derives the user's hub wallet via `EvmHubProvider.getUserHubWalletAddress` from the
 * spoke `chainKey` + spoke wallet `userAddress`.
 */
export function useATokensBalances({
  params,
  queryOptions,
}: UseATokensBalancesParams = {}): UseQueryResult<Map<Address, bigint>, Error> {
  const { sodax } = useSodaxContext();
  const aTokens = params?.aTokens ?? [];
  const spokeChainKey = params?.spokeChainKey;
  const userAddress = params?.userAddress;

  return useQuery({
    queryKey: ['mm', 'aTokensBalances', aTokens, spokeChainKey, userAddress],
    queryFn: async () => {
      if (aTokens.length === 0) {
        return new Map<Address, bigint>();
      }
      if (!spokeChainKey || !userAddress) {
        throw new Error('spokeChainKey and userAddress are required');
      }
      for (const aToken of aTokens) {
        if (!isAddress(aToken)) {
          throw new Error(`Invalid aToken address: ${aToken}`);
        }
      }

      const hubWalletAddress = await sodax.hubProvider.getUserHubWalletAddress(userAddress, spokeChainKey);
      return sodax.moneyMarket.data.getATokensBalances(aTokens, hubWalletAddress);
    },
    enabled: aTokens.length > 0 && !!spokeChainKey && !!userAddress,
    ...queryOptions,
  });
}
