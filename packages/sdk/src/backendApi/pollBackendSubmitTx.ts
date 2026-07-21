import type { Result } from '@sodax/types';

/**
 * Minimal structural view of a `getSubmitTxStatus` response `data` envelope, shared by the swaps and
 * bridge backend APIs. Both `SubmitTxStatusDataV2` (swaps) and `BridgeSubmitTxStatusDataV2` (bridge)
 * are assignable to this: bridge types `status` as a tolerant `string`, swaps as a literal union that
 * widens to `string`. `TResult` is the feature-specific `result` payload (present when executed).
 */
export interface BackendSubmitTxStatusEnvelope<TResult> {
  status: string;
  failureReason?: string;
  abandonedAt?: string;
  result?: TResult;
}

export type BackendSubmitTxPollResult<TValue> = { ok: true; value: TValue } | { ok: false; cause: Error };

/**
 * Shared poll loop for the opt-in backend submit-tx flow (`SwapService.submitTx` / `BridgeService.submitTx`).
 *
 * Polls `getStatus` until the backend reaches a terminal state, then returns the feature-specific
 * success value built by `onExecuted`, or a `cause` Error on terminal `failed` / abandoned or poll
 * timeout — the caller wraps that cause into its own feature error and falls back to the client-side
 * relay. Reserves up to a third of the remaining shared budget (capped at 20s) for that fallback, so a
 * stalled backend can't consume the whole `deadline` before the fallback gets a turn. Never throws.
 *
 * @param deadline - Absolute `Date.now()`-based ms timestamp shared with the client-side fallback.
 * @param terminalStatus - The feature's terminal-success status literal (`'solved'` for swaps,
 *   `'executed'` for bridge); `onExecuted` runs only once the status reaches it.
 * @param getStatus - Fetches one status snapshot (e.g. `backendApi.<feature>.getSubmitTxStatus`).
 * @param onExecuted - Builds the success value from a terminal-status result; returns `undefined` when
 *   the result is not yet complete so polling continues.
 * @param intervalMs - Poll interval in ms (default 1000).
 */
export async function pollBackendSubmitTx<TResult, TValue>({
  deadline,
  terminalStatus,
  getStatus,
  onExecuted,
  intervalMs = 1_000,
}: {
  deadline: number;
  terminalStatus: string;
  getStatus: () => Promise<Result<{ data: BackendSubmitTxStatusEnvelope<TResult> }>>;
  onExecuted: (result: TResult | undefined) => TValue | undefined;
  intervalMs?: number;
}): Promise<BackendSubmitTxPollResult<TValue>> {
  const reserveMs = Math.min(Math.ceil((deadline - Date.now()) / 3), 20_000);
  const pollDeadline = deadline - reserveMs;
  while (Date.now() < pollDeadline) {
    const statusResult = await getStatus();
    if (statusResult.ok) {
      const { status, result, failureReason, abandonedAt } = statusResult.value.data;
      if (status === terminalStatus) {
        const value = onExecuted(result);
        if (value !== undefined) return { ok: true, value };
      }
      if (status === 'failed' || abandonedAt) {
        const reason = failureReason ? `: ${failureReason}` : '';
        return { ok: false, cause: new Error(`backend submit-tx ${status}${reason}`) };
      }
    }
    // transient !ok / pending / relaying / relayed / posting_execution → keep polling
    await new Promise<void>(resolve => setTimeout(resolve, intervalMs));
  }
  return { ok: false, cause: new Error(`backend submit-tx polling timed out before reaching ${terminalStatus}`) };
}
