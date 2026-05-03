import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { RadfiWalletBalance, IBitcoinWalletProvider } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseTradingWalletBalanceParams = ReadHookParams<
  RadfiWalletBalance,
  {
    walletProvider: IBitcoinWalletProvider | undefined;
    tradingAddress: string | undefined;
  }
>;

export function useTradingWalletBalance({
  params,
  queryOptions,
}: UseTradingWalletBalanceParams = {}): UseQueryResult<RadfiWalletBalance, Error> {
  const { sodax } = useSodaxContext();
  const walletProvider = params?.walletProvider;
  const tradingAddress = params?.tradingAddress;

  return useQuery<RadfiWalletBalance, Error>({
    queryKey: ['trading-wallet-balance', tradingAddress],
    queryFn: () => {
      if (!walletProvider || !tradingAddress) {
        throw new Error('walletProvider and tradingAddress are required');
      }
      return sodax.spokeService.bitcoinSpokeService.radfi.getBalance(tradingAddress);
    },
    enabled: !!walletProvider && !!tradingAddress,
    ...queryOptions,
  });
}
