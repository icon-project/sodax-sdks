/** The tagged status union behind `SwapService.getDetailedStatus`. Pure — no I/O. */

import type { Hex, SolverIntentStatusResponse, SpokeChainKey, SubmitTxStatusDataV2 } from '@sodax/types';

/** The identity a detailed status is read for — the backend submit-tx record's key. */
export type DetailedSwapStatusKey = {
  srcChainKey: SpokeChainKey;
  srcTxHash: string;
};

/**
 * Which of the two existing status sources answered, with that source's payload unmodified.
 * A router, not a merge — see `docs/SWAPS.md` § Get Detailed Status.
 */
export type DetailedSwapStatus =
  | { source: 'backend'; data: SubmitTxStatusDataV2 }
  | { source: 'solver'; dstTxHash: Hex; data: SolverIntentStatusResponse };

/**
 * `error.context.reason` on the one `getDetailedStatus` failure that is not a dependency outage:
 * the relay has no delivered packet for this source tx.
 *
 * That state is ambiguous by nature — a swap still in flight and one whose tx never relayed at all
 * look identical here — so it is the only `LOOKUP_FAILED` a caller can sensibly bound with a retry
 * budget. Every other one (relay unreachable, malformed response, solver down) is something failing
 * *right now* and should be retried until it recovers; spending a budget on those would turn a
 * transient outage into a permanently stuck read.
 */
export const DETAILED_STATUS_NOT_DELIVERED = 'relay_not_delivered';

/**
 * True when the backend gave up on a record — it failed terminally or was abandoned mid-flight.
 * Such a record never self-heals, so it routes like a 404; keep it and a swap the client-side
 * fallback went on to complete would read `failed` forever.
 */
export function isBackendSubmitTxAbandoned(data: SubmitTxStatusDataV2): boolean {
  return data.status === 'failed' || Boolean(data.abandonedAt);
}
