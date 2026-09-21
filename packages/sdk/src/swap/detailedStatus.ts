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

// The budget vocabulary and the abandonment predicate are shared with the other features that have
// a backend submit-tx record, so they live in `backendApi/detailedStatusRouting.ts`. Re-exported
// here so `./index.js` keeps publishing the same name from the same place.
export { DETAILED_STATUS_NOT_DELIVERED, isBackendSubmitTxAbandoned } from '../backendApi/detailedStatusRouting.js';
