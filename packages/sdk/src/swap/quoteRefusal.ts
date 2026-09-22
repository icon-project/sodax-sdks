/**
 * Recognising the solver's "too small" refusal.
 *
 * The solver answers a quote below its floor with `{ detail: { code: -1, message: 'Input amount
 * too low' } }`. `-1` is not a member of `SolverIntentErrorCode`, and it is the same code the solver
 * uses for a routing refusal ("No path was found"), so the wording is the only thing that tells the
 * two apart. Matching it here keeps that fragility in one tested place instead of in every UI.
 *
 * The refusal reaches a caller in three shapes, all read here:
 *   - `sodax.swaps.getQuote` returns the raw `SolverErrorResponse`;
 *   - `sodax.api.swaps.getQuote` returns a `SodaxError` whose `cause` is the `SwapsApiError` for the
 *     backend's 422, with the solver's text in `context.body.message`
 *     ("Failed to get quote: Input amount too low");
 *   - a direct `@sodax/swaps-api` caller gets that `SwapsApiError` itself.
 */

/**
 * The current wording, plus the rename the solver team has floated ("Quote too small"), so a wording
 * change on their side does not silently turn this back into a generic error.
 */
const AMOUNT_TOO_SMALL_PATTERN = /input amount too low|quote too small/i;

/** How far a `cause` chain is followed. `SodaxError` → `SwapsApiError` is one hop. */
const MAX_CAUSE_DEPTH = 4;

type ErrorLike = {
  message?: unknown;
  detail?: unknown;
  context?: { body?: unknown; solverDetail?: unknown };
  cause?: unknown;
};

function messageOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return undefined;
  const message = (value as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

function* messagesOf(error: unknown, depth = 0): Generator<string> {
  if (depth > MAX_CAUSE_DEPTH) return;
  if (typeof error === 'string') {
    yield error;
    return;
  }
  if (typeof error !== 'object' || error === null) return;
  const e = error as ErrorLike;
  for (const message of [
    messageOf(e),
    messageOf(e.detail),
    messageOf(e.context?.body),
    messageOf(e.context?.solverDetail),
  ]) {
    if (message !== undefined) yield message;
  }
  yield* messagesOf(e.cause, depth + 1);
}

/**
 * Whether a failed quote was refused because the amount is below the solver's floor.
 *
 * Accepts anything a quote call can fail with: the `SolverErrorResponse` from `sodax.swaps.getQuote`,
 * the `SodaxError` from `sodax.api.swaps.getQuote`, a `SwapsApiError`, or a plain `Error` wrapping any
 * of them. Terminal for the amount entered: a UI should ask for a larger amount rather than retry or
 * keep polling.
 *
 * Read off the message, not `detail.code` — see the module note for why the code cannot be used.
 */
export function isAmountTooSmallRefusal(error: unknown): boolean {
  for (const message of messagesOf(error)) {
    if (AMOUNT_TOO_SMALL_PATTERN.test(message)) return true;
  }
  return false;
}
