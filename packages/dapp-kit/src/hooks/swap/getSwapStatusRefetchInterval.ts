import {
  SolverIntentStatusCode,
  type Result,
  type SolverErrorResponse,
  type SolverIntentStatusResponse,
} from '@sodax/sdk';

export const STATUS_POLL_MS = 3000;
/** Cap consecutive NOT_FOUND polls (~2 min at 3s). First NOT_FOUND is a race, not a stop. */
export const MAX_NOT_FOUND_POLLS = 40;

export type SwapStatusResult = Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined;

export type NotFoundStreakState = {
  intentTxHash: string | undefined;
  seenUpdates: number;
  consecutiveNotFound: number;
};

export const INITIAL_NOT_FOUND_STREAK: NotFoundStreakState = {
  intentTxHash: undefined,
  seenUpdates: 0,
  consecutiveNotFound: 0,
};

/**
 * Polling interval for `useStatus`. Stops on SOLVED/FAILED immediately; stops on NOT_FOUND only
 * after `MAX_NOT_FOUND_POLLS` consecutive successful fetches (solver forgot / never saw the intent).
 * In-flight statuses keep polling with no global cap.
 *
 * Kept in its own pure module (no React/context imports) so it is unit-testable in dapp-kit's
 * `node` test environment — importing the hook itself pulls in `useSodaxContext`.
 */
export function getSwapStatusRefetchInterval(data: SwapStatusResult, consecutiveNotFound: number): number | false {
  const status = data?.ok ? data.value.status : undefined;
  if (status === SolverIntentStatusCode.SOLVED || status === SolverIntentStatusCode.FAILED) {
    return false;
  }
  if (status === SolverIntentStatusCode.NOT_FOUND && consecutiveNotFound >= MAX_NOT_FOUND_POLLS) {
    return false;
  }
  return STATUS_POLL_MS;
}

export function nextNotFoundStreak(data: SwapStatusResult, previousStreak: number): number {
  const status = data?.ok ? data.value.status : undefined;
  return status === SolverIntentStatusCode.NOT_FOUND ? previousStreak + 1 : 0;
}

/**
 * Advances the consecutive-NOT_FOUND counter once per successful query update. A hash change
 * starts a new streak so a prior intent's count cannot stop the next one. React Query may call
 * `refetchInterval` more than once per fetch — same `dataUpdateCount` is a no-op.
 */
export function advanceNotFoundStreak(
  state: NotFoundStreakState,
  intentTxHash: string | undefined,
  data: SwapStatusResult,
  dataUpdateCount: number,
): NotFoundStreakState {
  if (state.intentTxHash !== intentTxHash) {
    state = { intentTxHash, seenUpdates: 0, consecutiveNotFound: 0 };
  }
  if (state.seenUpdates === dataUpdateCount) {
    return state;
  }
  return {
    intentTxHash,
    seenUpdates: dataUpdateCount,
    consecutiveNotFound: nextNotFoundStreak(data, state.consecutiveNotFound),
  };
}
