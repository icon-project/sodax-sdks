import {
  DETAILED_STATUS_NOT_DELIVERED,
  SolverIntentStatusCode,
  type DetailedStatusError,
  type DetailedSwapStatus,
  type Result,
  type SolverErrorResponse,
  type SolverIntentStatusResponse,
} from '@sodax/sdk';

export const STATUS_POLL_MS = 3000;
/** Cap consecutive NOT_FOUND polls (~2 min at 3s). First NOT_FOUND is a race, not a stop. */
export const MAX_NOT_FOUND_POLLS = 40;

export type SwapStatusResult = Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined;

export type NotFoundStreakState = {
  /** Identity of what is being polled — an intent tx hash, or a composite source-chain/tx key. */
  pollKey: string | undefined;
  seenUpdates: number;
  consecutiveNotFound: number;
};

export const INITIAL_NOT_FOUND_STREAK: NotFoundStreakState = {
  pollKey: undefined,
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
 * Advances the consecutive-NOT_FOUND counter once per successful query update. A `pollKey` change
 * starts a new streak so a prior intent's count cannot stop the next one. React Query may call
 * `refetchInterval` more than once per fetch — same `dataUpdateCount` is a no-op.
 */
export function advanceNotFoundStreak(
  state: NotFoundStreakState,
  pollKey: string | undefined,
  data: SwapStatusResult,
  dataUpdateCount: number,
): NotFoundStreakState {
  if (state.pollKey !== pollKey) {
    state = { pollKey, seenUpdates: 0, consecutiveNotFound: 0 };
  }
  if (state.seenUpdates === dataUpdateCount) {
    return state;
  }
  return {
    pollKey,
    seenUpdates: dataUpdateCount,
    consecutiveNotFound: nextNotFoundStreak(data, state.consecutiveNotFound),
  };
}

/**
 * Structural mirror of `useDetailedStatus`'s data type. Declared locally rather than imported so
 * this module does not own another hook's public contract — `UseDetailedStatusResult` lives with
 * the hook.
 */
type DetailedStatusRead = Result<DetailedSwapStatus, DetailedStatusError> | undefined;

/**
 * Maps a detailed-status read onto the shape the shared NOT_FOUND policy consumes, three ways:
 *
 * - solver arm → passes through, so its status drives the budget as it does for `useStatus`;
 * - backend arm → `undefined`, which resets the budget; the solver is not the one being asked;
 * - failed read → counts as `NOT_FOUND` **only** when the relay has no packet for this source tx
 *   (`DETAILED_STATUS_NOT_DELIVERED`). That miss is ambiguous — a swap still in flight and one whose
 *   tx never relayed look the same — so a budget is the only way to stop the second case.
 *
 * Every other `LOOKUP_FAILED` is a dependency failing right now: the relay unreachable, a malformed
 * response, the solver down. Those reset the budget and keep polling, because that is how the read
 * recovers when the outage ends. Counting them would stop polling a healthy swap after ~2 min of
 * downtime and never resume.
 */
export function toNotFoundBudgetRead(data: DetailedStatusRead): SwapStatusResult {
  if (data === undefined) return undefined;
  if (data.ok) {
    return data.value.source === 'solver' ? { ok: true, value: data.value.data } : undefined;
  }
  return data.error?.context?.reason === DETAILED_STATUS_NOT_DELIVERED
    ? { ok: true, value: { status: SolverIntentStatusCode.NOT_FOUND } }
    : undefined;
}

/**
 * Polling interval for `useDetailedStatus`. Backend records report terminality in their own
 * vocabulary; everything else reuses `useStatus`'s policy verbatim, so `MAX_NOT_FOUND_POLLS` stays
 * the single cutoff — for a forgotten intent and for a swap no source can resolve.
 */
export function getDetailedStatusRefetchInterval(
  data: DetailedStatusRead,
  consecutiveNotFound: number,
): number | false {
  if (data?.ok && data.value.source === 'backend') {
    // Both terminal states of `SubmitSwapTxStatusV2`. Today the SDK routes `'failed'` records to the
    // solver so only `'solved'` reaches us, but that is its routing rule, not this hook's contract —
    // encoding the wire contract keeps a terminal record from being polled forever if it changes.
    const { status } = data.value.data;
    return status === 'solved' || status === 'failed' ? false : STATUS_POLL_MS;
  }
  return getSwapStatusRefetchInterval(toNotFoundBudgetRead(data), consecutiveNotFound);
}
