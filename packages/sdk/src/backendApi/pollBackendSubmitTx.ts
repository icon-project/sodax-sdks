import type { Result } from '@sodax/types';
import type { RequestOverrideConfig } from './api-utils.js';

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
 * The sleep never runs past that cutoff, and neither does a request when the caller supplies
 * `requestTimeoutMs`: the per-call override is `min(budget left before the cutoff, requestTimeoutMs)`.
 * Clamping matters in BOTH directions — `makeRequest` resolves `overrideConfig.timeout ?? config.timeout`,
 * so an override is the effective timeout outright. Passing the raw remainder would RAISE the bound
 * whenever it exceeds the service default (100s vs 30s on a default 120s bridge budget), letting one
 * stalled request burn the whole poll window on a single attempt instead of retrying.
 *
 * @param deadline - Absolute `Date.now()`-based ms timestamp shared with the client-side fallback.
 * @param terminalStatus - The feature's terminal-success status literal (`'solved'` for swaps,
 *   `'executed'` for bridge); `onExecuted` runs only once the status reaches it.
 * @param getStatus - Fetches one status snapshot (e.g. `backendApi.<feature>.getSubmitTxStatus`).
 *   Receives the clamped per-call override when `requestTimeoutMs` is set, else no override at all.
 * @param onExecuted - Builds the success value from a terminal-status result; returns `undefined` when
 *   the result is not yet complete so polling continues.
 * @param intervalMs - Poll interval in ms (default 1000).
 * @param requestTimeoutMs - The service's own effective request timeout (e.g.
 *   `backendApi.bridge.getTimeout()`). Supply it to bound each request by the poll cutoff without ever
 *   exceeding the service default; omit it to leave every request on the service default. Bridge
 *   supplies it so a stalled request cannot eat the fallback's reserve.
 */
export async function pollBackendSubmitTx<TResult, TValue>({
  deadline,
  terminalStatus,
  getStatus,
  onExecuted,
  intervalMs = 1_000,
  requestTimeoutMs,
}: {
  deadline: number;
  terminalStatus: string;
  getStatus: (override?: RequestOverrideConfig) => Promise<Result<{ data: BackendSubmitTxStatusEnvelope<TResult> }>>;
  onExecuted: (result: TResult | undefined) => TValue | undefined;
  intervalMs?: number;
  requestTimeoutMs?: number;
}): Promise<BackendSubmitTxPollResult<TValue>> {
  const reserveMs = Math.min(Math.ceil((deadline - Date.now()) / 3), 20_000);
  const pollDeadline = deadline - reserveMs;
  // Clamped per-call override, or none when the caller opted out — see `requestTimeoutMs`.
  const requestOverride = (): RequestOverrideConfig | undefined =>
    requestTimeoutMs === undefined ? undefined : { timeout: Math.min(pollDeadline - Date.now(), requestTimeoutMs) };

  while (Date.now() < pollDeadline) {
    const statusResult = await getStatus(requestOverride());
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
    // transient !ok / pending / relaying / relayed / posting_execution → keep polling, never past the cutoff
    await new Promise<void>(resolve => setTimeout(resolve, Math.min(intervalMs, pollDeadline - Date.now())));
  }
  return { ok: false, cause: new Error(`backend submit-tx polling timed out before reaching ${terminalStatus}`) };
}
