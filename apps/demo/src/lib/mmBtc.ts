import { ChainKeys, type SpokeChainKey } from '@sodax/sdk';
import { loadRadfiSession } from '@sodax/dapp-kit';

type MmCrossChainParams = { dstChainKey?: SpokeChainKey; dstAddress?: string };

/**
 * Build the cross-chain delivery params (`dstChainKey`/`dstAddress`) for a money-market
 * borrow/withdraw.
 *
 * Bitcoin destinations must deliver to the Radfi **trading** wallet (not the personal wallet),
 * and dst params are always sent so the relay routes there even same-chain. Returns `null` when
 * a Bitcoin delivery address is required but missing — the caller should treat that as
 * "params not ready" and return `undefined`. Non-Bitcoin keeps the standard same-chain shortcut.
 */
export function buildMmDeliveryParams(opts: {
  dstChainKey: SpokeChainKey;
  dstAddress: string | undefined;
  isSameChain: boolean;
}): MmCrossChainParams | null {
  const { dstChainKey, dstAddress, isSameChain } = opts;
  if (dstChainKey === ChainKeys.BITCOIN_MAINNET) {
    if (!dstAddress) return null;
    return { dstChainKey, dstAddress: loadRadfiSession(dstAddress)?.tradingAddress ?? dstAddress };
  }
  return isSameChain ? {} : { dstChainKey, dstAddress };
}
