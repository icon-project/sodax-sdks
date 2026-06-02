import { ChainKeys, type SpokeChainKey } from '@sodax/sdk';
import { loadRadfiSession } from '@sodax/dapp-kit';

type MmCrossChainParams = { dstChainKey?: SpokeChainKey; dstAddress?: string };

/**
 * Build the cross-chain delivery params (`dstChainKey`/`dstAddress`) for a money-market
 * borrow/withdraw.
 *
 * Bitcoin destinations must deliver to the Bound Exchange **trading** wallet (not the personal wallet),
 * and dst params are always sent so the relay routes there even same-chain. Returns `null` when
 * the Bitcoin trading address can't be resolved (no destination wallet, or no signed-in Bound Exchange
 * session) — the caller should treat that as "params not ready" and return `undefined`, rather
 * than silently delivering to the personal wallet. Non-Bitcoin keeps the same-chain shortcut.
 */
export function buildMmDeliveryParams(opts: {
  dstChainKey: SpokeChainKey;
  dstAddress: string | undefined;
  isSameChain: boolean;
}): MmCrossChainParams | null {
  const { dstChainKey, dstAddress, isSameChain } = opts;
  if (dstChainKey === ChainKeys.BITCOIN_MAINNET) {
    if (!dstAddress) return null;
    const tradingAddress = loadRadfiSession(dstAddress)?.tradingAddress;
    if (!tradingAddress) return null; // block rather than deliver to the personal wallet
    return { dstChainKey, dstAddress: tradingAddress };
  }
  return isSameChain ? {} : { dstChainKey, dstAddress };
}
