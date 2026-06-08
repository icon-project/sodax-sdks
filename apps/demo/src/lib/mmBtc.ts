import { ChainKeys, type SpokeChainKey } from '@sodax/sdk';

type MmCrossChainParams = { dstChainKey?: SpokeChainKey; dstAddress?: string };

/**
 * Build the cross-chain delivery params (`dstChainKey`/`dstAddress`) for a money-market
 * borrow/withdraw.
 *
 * Bitcoin destinations must deliver to the Bound Exchange **trading** wallet (not the personal wallet),
 * and dst params are always sent so the relay routes there even same-chain. Pass the reactive
 * `btcTradingAddress` resolved by `useBtcTradingBalance` — the same source the modal's readiness
 * banner uses — so this stays in sync with the UI (a plain localStorage read here would not
 * re-run when the trading wallet resolves while the modal is open). Returns `null` when a Bitcoin
 * destination can't be resolved (no destination wallet, or its trading address isn't available yet) —
 * the caller should treat that as "params not ready" and return `undefined`, rather than silently
 * delivering to the personal wallet. Non-Bitcoin keeps the same-chain shortcut.
 */
export function buildMmDeliveryParams(opts: {
  dstChainKey: SpokeChainKey;
  dstAddress: string | undefined;
  isSameChain: boolean;
  btcTradingAddress: string | undefined;
}): MmCrossChainParams | null {
  const { dstChainKey, dstAddress, isSameChain, btcTradingAddress } = opts;
  if (dstChainKey === ChainKeys.BITCOIN_MAINNET) {
    if (!dstAddress) return null;
    if (!btcTradingAddress) return null; // block rather than deliver to the personal wallet
    return { dstChainKey, dstAddress: btcTradingAddress };
  }
  return isSameChain ? {} : { dstChainKey, dstAddress };
}
