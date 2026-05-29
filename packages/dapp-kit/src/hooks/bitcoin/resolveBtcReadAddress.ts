import { ChainKeys, type SpokeChainKey } from '@sodax/sdk';
import { loadRadfiSession } from './useRadfiAuth.js';

/**
 * Resolve a spoke address for READ queries (positions, balances, hub-wallet display).
 *
 * Bitcoin positions live under the Radfi trading-wallet-derived hub wallet, so for Bitcoin we
 * resolve to the trading address from the locally-persisted Radfi session. This is intentionally
 * a LOCAL lookup (no network call): a transient Radfi API outage can never make a real position
 * read as empty, and reads never throw "Trading wallet not found". When there is no session, the
 * user has no Bitcoin position to show, so the original (personal) address is returned — deriving
 * an empty hub wallet, which is correct. Non-Bitcoin chains pass through unchanged.
 *
 * The WRITE path resolves the trading address authoritatively in the SDK
 * (`MoneyMarketService.resolveSender`); reads deliberately use this lighter, fail-safe path.
 */
export function resolveBtcReadAddress(chainKey: SpokeChainKey, address: string): string {
  if (chainKey !== ChainKeys.BITCOIN_MAINNET) return address;
  return loadRadfiSession(address)?.tradingAddress ?? address;
}
