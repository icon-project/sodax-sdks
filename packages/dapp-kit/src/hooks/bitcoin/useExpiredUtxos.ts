import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { RadfiUtxo, IBitcoinWalletProvider } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseExpiredUtxosParams = ReadHookParams<
  RadfiUtxo[],
  {
    walletProvider: IBitcoinWalletProvider | undefined;
    tradingAddress: string | undefined;
  }
>;

export function useExpiredUtxos({
  params,
  queryOptions,
}: UseExpiredUtxosParams = {}): UseQueryResult<RadfiUtxo[], Error> {
  const { sodax } = useSodaxContext();
  const walletProvider = params?.walletProvider;
  const tradingAddress = params?.tradingAddress;

  return useQuery<RadfiUtxo[], Error>({
    queryKey: ['expired-utxos', tradingAddress],
    queryFn: async () => {
      if (!walletProvider || !tradingAddress) {
        throw new Error('walletProvider and tradingAddress are required');
      }
      const result = await sodax.spokeService.bitcoinSpokeService.radfi.getExpiredUtxos(tradingAddress);
      return result.data;
    },
    enabled: !!walletProvider && !!tradingAddress,
    refetchInterval: 60_000,
    ...queryOptions,
  });
}
