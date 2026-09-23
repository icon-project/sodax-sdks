/**
 * Presenting a solver refusal so the demo shows WHY a swap failed, not just that it did.
 *
 * Two shapes carry a solver code. The quote path (`useQuote`) hands back the SDK `Result`, so
 * `error.detail.code` is already typed; the swap path throws a `SodaxError` whose `context.solverCode`
 * rides an open index signature and has to be narrowed. Hence two entry points over one formatter.
 */

import { getSolverErrorRetryability, isSodaxError, SolverIntentErrorCode } from '@sodax/dapp-kit';
import { formatMutationFailureMessage } from './utils';

type SolverCodeCopy = { label: string; text: string };

/**
 * Only codes whose meaning is documented upstream. The ones marked "meaning not documented" in
 * packages/sdk/docs/SOLVER_API_ENDPOINTS.md are deliberately absent — guessing at them would put
 * invented semantics in front of a user, so they fall through to the solver's own message.
 */
const SOLVER_CODE_COPY: ReadonlyMap<number, SolverCodeCopy> = new Map([
  [
    SolverIntentErrorCode.UNCLASSIFIED,
    { label: 'UNCLASSIFIED', text: 'The solver rejected the request without naming a reason.' },
  ],
  [
    SolverIntentErrorCode.NO_PATH_FOUND,
    { label: 'NO_PATH_FOUND', text: 'No route between these two tokens at this size.' },
  ],
  [
    SolverIntentErrorCode.NO_PRIVATE_LIQUIDITY,
    { label: 'NO_PRIVATE_LIQUIDITY', text: 'A route exists, but there is no liquidity on the destination chain.' },
  ],
  [
    SolverIntentErrorCode.NO_EXECUTION_MODULE_FOUND,
    { label: 'NO_EXECUTION_MODULE_FOUND', text: 'Route and liquidity found, but no execution module is available.' },
  ],
  // -8 is two codes: NOT_ENOUGH_PRIVATE_LIQUIDITY and QUOTE_NOT_FOUND share the value and cannot be
  // told apart at runtime, so name both rather than pick one.
  [
    SolverIntentErrorCode.QUOTE_NOT_FOUND,
    {
      label: 'NOT_ENOUGH_PRIVATE_LIQUIDITY / QUOTE_NOT_FOUND',
      text: 'Not enough liquidity on the destination chain, or the quote no longer exists.',
    },
  ],
  [
    SolverIntentErrorCode.QUOTE_NOT_MATCH,
    { label: 'QUOTE_NOT_MATCH', text: 'The quote does not match the intent being executed.' },
  ],
  [SolverIntentErrorCode.INTENT_NOT_FOUND, { label: 'INTENT_NOT_FOUND', text: 'No intent exists for that hash.' }],
  [SolverIntentErrorCode.STOPPED, { label: 'STOPPED', text: 'The solver is not currently serving requests.' }],
  [
    SolverIntentErrorCode.NEGATIVE_INPUT_AMOUNT,
    { label: 'NEGATIVE_INPUT_AMOUNT', text: 'The input amount was negative.' },
  ],
  [SolverIntentErrorCode.INVALID_QUOTE_TYPE, { label: 'INVALID_QUOTE_TYPE', text: 'Unsupported quote type.' }],
  [
    SolverIntentErrorCode.INVALID_TOKENS,
    { label: 'INVALID_TOKENS', text: 'One of the tokens is not supported by the quote service.' },
  ],
  [SolverIntentErrorCode.INVALID_AMOUNT, { label: 'INVALID_AMOUNT', text: 'The amount could not be parsed.' }],
  [
    SolverIntentErrorCode.INPUT_AMOUNT_TOO_LOW,
    { label: 'INPUT_AMOUNT_TOO_LOW', text: "Below the solver's minimum input — increase the amount." },
  ],
  [
    SolverIntentErrorCode.ALGORITHM_NOT_IMPLEMENTED,
    { label: 'ALGORITHM_NOT_IMPLEMENTED', text: 'The requested routing algorithm is not implemented.' },
  ],
  [SolverIntentErrorCode.UNKNOWN_DEX_ID, { label: 'UNKNOWN_DEX_ID', text: 'Unrecognised entry in excluded DEX ids.' }],
  [
    SolverIntentErrorCode.UNKNOWN,
    { label: 'UNKNOWN', text: 'The SDK could not reach the solver, or the call timed out.' },
  ],
]);

const RETRY_ADVICE = {
  retryable: 'The solver is temporarily unavailable. Wait a few seconds and try again.',
  'not-retryable': 'Retrying the same request will not help — change the amount or the token pair.',
  unknown: 'The solver did not say whether this is temporary. Refresh the quote; if it repeats, change the amount or the pair.',
} as const;

/** Reads the solver code off a thrown `SodaxError`. Returns undefined when there is none. */
export function getSolverCode(error: unknown): number | undefined {
  if (!isSodaxError(error)) return undefined;
  const raw = error.context?.solverCode;
  return typeof raw === 'number' ? raw : undefined;
}

/**
 * Renders a solver refusal as the demo's error copy: what happened, whether retrying can help, and the
 * raw code — this app deliberately exposes the numbers a production dApp would hide.
 */
export function getSolverErrorText(code: number | undefined, message: string): string {
  if (code === undefined) return message;

  const copy = SOLVER_CODE_COPY.get(code);
  const lines = [copy?.text ?? message, RETRY_ADVICE[getSolverErrorRetryability(code)]];
  lines.push(`Solver code ${code} (${copy?.label ?? 'unrecognised'})`);
  if (copy && message && message !== copy.text) lines.push(`Detail: ${message}`);

  return lines.join('\n');
}

/** Mutation-path adapter: adds solver context when present, otherwise the existing formatting. */
export function getSwapErrorText(error: unknown, fallback: string): string {
  const message = formatMutationFailureMessage(error, fallback);
  return getSolverErrorText(getSolverCode(error), message);
}
