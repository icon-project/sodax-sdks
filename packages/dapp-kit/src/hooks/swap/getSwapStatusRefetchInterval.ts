/**
 * Swap's status-polling policy. The rules themselves are not swap-specific — leverage yield resolves
 * a source tx to the same two arms — so they live in `hooks/shared/solverStatusPolicy.ts` and this
 * module is the swap-named face of them, kept so the swap hooks and their tests keep one import site
 * for the whole policy.
 */
import type {
  DetailedStatusError,
  DetailedSwapStatus,
  Result,
  SolverErrorResponse,
  SolverIntentStatusResponse,
} from '@sodax/sdk';

import {
  advanceNotFoundStreak,
  INITIAL_NOT_FOUND_STREAK,
  MAX_NOT_FOUND_POLLS,
  nextNotFoundStreak,
  STATUS_POLL_MS,
  type NotFoundStreakState,
} from '../shared/notFoundStreak.js';
import {
  getSolverDetailedStatusRefetchInterval,
  getSolverStatusRefetchInterval,
  isSolverNotFound,
  toNotFoundBudgetRead,
} from '../shared/solverStatusPolicy.js';

// Re-exported so the swap hooks and their tests keep one import site for the whole policy.
export {
  advanceNotFoundStreak,
  INITIAL_NOT_FOUND_STREAK,
  MAX_NOT_FOUND_POLLS,
  nextNotFoundStreak,
  STATUS_POLL_MS,
  type NotFoundStreakState,
};
export { isSolverNotFound, toNotFoundBudgetRead };

/** A solver status read, as `useStatus` holds it. */
export type SwapStatusResult = Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined;

/**
 * Polling interval for `useStatus`. Stops on SOLVED/FAILED immediately; stops on NOT_FOUND only
 * after `MAX_NOT_FOUND_POLLS` consecutive successful fetches (solver forgot / never saw the intent).
 * In-flight statuses keep polling with no global cap.
 */
export function getSwapStatusRefetchInterval(data: SwapStatusResult, consecutiveNotFound: number): number | false {
  return getSolverStatusRefetchInterval(data, consecutiveNotFound);
}

/**
 * Structural mirror of `useDetailedStatus`'s data type. Declared locally rather than imported so
 * this module does not own another hook's public contract — `UseDetailedStatusResult` lives with
 * the hook.
 */
type DetailedStatusRead = Result<DetailedSwapStatus, DetailedStatusError> | undefined;

/**
 * Polling interval for `useDetailedStatus`. Backend records report terminality in their own
 * vocabulary, a rejected API key stops the poll outright, and everything else reuses `useStatus`'s
 * policy verbatim — see `getSolverDetailedStatusRefetchInterval` for why each of those is where the
 * cutoff belongs.
 */
export function getDetailedStatusRefetchInterval(
  data: DetailedStatusRead,
  consecutiveNotFound: number,
): number | false {
  return getSolverDetailedStatusRefetchInterval(data, consecutiveNotFound);
}
