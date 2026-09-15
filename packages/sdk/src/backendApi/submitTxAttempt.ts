import { resolveTimeoutMs } from '../shared/utils/resolveTimeoutMs.js';

/**
 * Budget for ONE backend submit-tx attempt (`POST /<feature>/submit-tx` plus the status poll that
 * follows it), owned by `SwapService.submitTx` / `BridgeService.submitTx` and the shared poll loop.
 *
 * It is deliberately NOT shared with the client-side relay fallback: the fallback gets its own fresh
 * `timeout`, so a backend that stalls for its entire attempt cannot shorten the relay wait. Total
 * wall-clock is therefore the sum of the two plus the phases neither bounds (intent creation,
 * verification, post-execution) — see `docs/SWAPS.md` § How `timeout` bounds each attempt.
 */
export interface SubmitTxAttempt {
  /** Milliseconds left before the attempt is over; never negative. */
  remaining(): number;
  /**
   * Per-request override for one backend call inside this attempt: the budget left, but never above the
   * service's own timeout — or `null` when no request should be issued.
   *
   * An override REPLACES `config.timeout` rather than lowering it, so the raw remainder would RAISE the
   * bound whenever it is the larger of the two. Clamping down to the service value keeps a stalled
   * request retryable; clamping down to the remainder keeps it inside the attempt. It does not stop a
   * request from consuming the whole remainder — only from being configured to outlive it.
   *
   * Callers **compute once, then check**: `null` is unusable as a `RequestOverrideConfig.timeout`, so
   * they cannot guard on one reading of the clock and send on a later one.
   */
  requestTimeout(serviceTimeoutMs: number): number | null;
}

/**
 * Explain a `null` request bound. It has two causes that need different fixes — the caller's `timeout`
 * ran out, or `api.timeout` is not a positive number — and reporting the first for both sends whoever
 * reads the log looking at the wrong setting.
 */
export function noRequestBudgetCause(serviceTimeoutMs: number): Error {
  return serviceTimeoutMs > 0
    ? new Error('backend submit-tx skipped: the caller timeout left no budget for the attempt')
    : new Error(`backend submit-tx skipped: api timeout must be a positive number, got ${serviceTimeoutMs}`);
}

/**
 * Open a backend submit-tx attempt lasting `callerTimeoutMs` from now — a value already through
 * {@link resolveTimeoutMs}, so it is finite and non-negative.
 *
 * The deadline stays private: everything downstream asks for time remaining or a clamped per-request
 * override, so there is no second place where the budget can be re-derived differently.
 */
export function createSubmitTxAttempt(callerTimeoutMs: number): SubmitTxAttempt {
  const deadline = Date.now() + resolveTimeoutMs(callerTimeoutMs, 0);
  const remaining = (): number => Math.max(0, deadline - Date.now());

  return {
    remaining,
    requestTimeout: (serviceTimeoutMs: number): number | null => {
      const timeout = Math.min(remaining(), serviceTimeoutMs);
      return timeout > 0 ? timeout : null;
    },
  };
}
