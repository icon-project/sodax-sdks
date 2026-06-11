import { useTradingWallet, useTradingWalletBalance } from '@sodax/dapp-kit';
import { ChainKeys, type IBitcoinWalletProvider, type SpokeChainKey } from '@sodax/sdk';
import { useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';

interface UseBtcTradingBalanceParams {
  chainId: SpokeChainKey;
}

interface UseBtcTradingBalanceResult {
  isBitcoin: boolean;
  tradingAddress: string | undefined;
  tradingBalanceSats: bigint;
  /** True when Bitcoin is selected but the trading wallet can't fund a source action yet
   * (not signed in / empty balance). Used to gate supply/repay. */
  notReady: boolean;
}

/**
 * Money-market BTC funds live in the user's Bound Exchange trading wallet, not their personal wallet.
 * Reads the trading-wallet balance for that chain; returns zeros for non-Bitcoin chains.
 * Read-only — the Bound Exchange session itself is owned by BitcoinSetupPanel's useRadfiSession.
 */
export function useBtcTradingBalance({ chainId }: UseBtcTradingBalanceParams): UseBtcTradingBalanceResult {
  const isBitcoin = chainId === ChainKeys.BITCOIN_MAINNET;
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BITCOIN_MAINNET }) as
    | IBitcoinWalletProvider
    | undefined;
  const { address } = useXAccount({ xChainId: ChainKeys.BITCOIN_MAINNET });
  const { tradingAddress } = useTradingWallet(address);

  const { data } = useTradingWalletBalance({
    params: { walletProvider: isBitcoin ? walletProvider : undefined, tradingAddress },
  });

  const tradingBalanceSats = data?.btcSatoshi ?? 0n;

  return {
    isBitcoin,
    tradingAddress,
    tradingBalanceSats,
    notReady: isBitcoin && (!tradingAddress || tradingBalanceSats === 0n),
  };
}
