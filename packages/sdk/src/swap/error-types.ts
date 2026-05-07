/**
 * Swap module error code unions.
 *
 * Every swap-module method that uses the canonical error shape returns
 * `Result<T, SodaxError<NarrowCode>>` where `NarrowCode` is one of the unions defined here.
 * This gives callers compile-time exhaustive checking on `result.error.code`.
 *
 * **Code naming convention:** module-prefixed SCREAMING_SNAKE_CASE (e.g. `SWAP_RELAY_TIMEOUT`).
 *
 * Codes are organized into two groups:
 * - `SwapValidationCode` — preconditions / invariant failures.
 * - `SwapPhaseCode` — failures of a specific orchestration phase
 *   (intent creation, verify, submit, relay, post-execution, solver API).
 *
 * @see {@link ../errors/SodaxError | SodaxError}
 */

import type { SolverErrorResponse, SolverIntentErrorCode } from '@sodax/types';
import { isSodaxError, SodaxError } from '../errors/SodaxError.js';
import { assertOk } from '../shared/utils/tiny-invariant.js';

export type SwapValidationCode = 'SWAP_VALIDATION_FAILED';

export type SwapPhaseCode =
  | 'SWAP_INTENT_CREATION_FAILED'
  | 'SWAP_VERIFY_FAILED'
  | 'SWAP_SUBMIT_TX_FAILED'
  | 'SWAP_RELAY_TIMEOUT'
  | 'SWAP_RELAY_FAILED'
  | 'SWAP_POST_EXECUTION_FAILED'
  | 'SWAP_SOLVER_API_ERROR'
  | 'SWAP_UNKNOWN';

/** Error codes that {@link SwapService.createIntent} can return. */
export type CreateIntentErrorCode = SwapValidationCode | 'SWAP_INTENT_CREATION_FAILED' | 'SWAP_UNKNOWN';

/**
 * Error codes that {@link SwapService.postExecution} can return.
 *
 * **By design, `postExecution` alone never emits relay/verify codes** — those appear only on
 * `swap` because only `swap` orchestrates verify + relay. Do not write a unified switch
 * that handles both `postExecution` and `swap` errors expecting the same union.
 */
export type PostExecutionErrorCode = 'SWAP_POST_EXECUTION_FAILED' | 'SWAP_SOLVER_API_ERROR' | 'SWAP_UNKNOWN';

/** Error codes that {@link SwapService.swap} (and delegating `createLimitOrder`) can return. */
export type SwapErrorCode = SwapValidationCode | SwapPhaseCode;

/** Phase tag for {@link SwapErrorContext.phase}. */
export type SwapPhase = 'validate' | 'createIntent' | 'verify' | 'submit' | 'relay' | 'postExecution';

/**
 * Standard `context` payload attached to swap errors. Concrete fields vary per code; the type
 * is declared as `Partial` because not every site populates every field.
 *
 * - `srcChainKey` / `dstChainKey` — low-cardinality. Suitable for logger tags / Sentry tags.
 * - `phase` — orchestration phase tag for filtering by step.
 * - `solverCode` / `solverDetail` — only set on `SWAP_SOLVER_API_ERROR`.
 * - `relayCode` — only set on `SWAP_RELAY_TIMEOUT` / `SWAP_SUBMIT_TX_FAILED` / `SWAP_RELAY_FAILED`.
 * - `field` / `reason` / other free-form fields — only on `SWAP_VALIDATION_FAILED`.
 */
export type SwapErrorContext = {
  srcChainKey?: string;
  dstChainKey?: string;
  phase?: SwapPhase;
  solverCode?: SolverIntentErrorCode;
  solverDetail?: SolverErrorResponse['detail'];
  relayCode?: 'SUBMIT_TX_FAILED' | 'RELAY_TIMEOUT' | 'RELAY_POLLING_FAILED' | 'UNKNOWN';
  field?: string;
  reason?: string;
  [key: string]: unknown;
};

export type CreateIntentError = SodaxError<CreateIntentErrorCode>;
export type PostExecutionError = SodaxError<PostExecutionErrorCode>;
export type SwapError = SodaxError<SwapErrorCode>;

// Sets back the literal-union code lists so the type guards below can do a runtime membership
// check rather than a blind `as` cast. Keeping these in lockstep with the union types is a
// small maintenance cost; the alternative (an `as XError` cast after a generic `isSodaxError`
// check) silently widens the contract — a future throw of `SodaxError<'SWAP_RELAY_TIMEOUT'>`
// from inside `postExecution` would propagate as a `PostExecutionError` at compile time.
const CREATE_INTENT_ERROR_CODES = new Set<string>([
  'SWAP_VALIDATION_FAILED',
  'SWAP_INTENT_CREATION_FAILED',
  'SWAP_UNKNOWN',
] satisfies CreateIntentErrorCode[]);

const POST_EXECUTION_ERROR_CODES = new Set<string>([
  'SWAP_POST_EXECUTION_FAILED',
  'SWAP_SOLVER_API_ERROR',
  'SWAP_UNKNOWN',
] satisfies PostExecutionErrorCode[]);

const SWAP_ERROR_CODES = new Set<string>([
  'SWAP_VALIDATION_FAILED',
  'SWAP_INTENT_CREATION_FAILED',
  'SWAP_VERIFY_FAILED',
  'SWAP_SUBMIT_TX_FAILED',
  'SWAP_RELAY_TIMEOUT',
  'SWAP_RELAY_FAILED',
  'SWAP_POST_EXECUTION_FAILED',
  'SWAP_SOLVER_API_ERROR',
  'SWAP_UNKNOWN',
] satisfies SwapErrorCode[]);

/** Type guard for {@link CreateIntentError}: SodaxError whose code is in the createIntent narrow union. */
export function isCreateIntentError(e: unknown): e is CreateIntentError {
  return isSodaxError(e) && CREATE_INTENT_ERROR_CODES.has(e.code);
}

/** Type guard for {@link PostExecutionError}: SodaxError whose code is in the postExecution narrow union. */
export function isPostExecutionError(e: unknown): e is PostExecutionError {
  return isSodaxError(e) && POST_EXECUTION_ERROR_CODES.has(e.code);
}

/** Type guard for {@link SwapError}: SodaxError whose code is in the swap narrow union. */
export function isSwapError(e: unknown): e is SwapError {
  return isSodaxError(e) && SWAP_ERROR_CODES.has(e.code);
}

/**
 * Precondition assertion for swap-module methods. Throws
 * `SodaxError<'SWAP_VALIDATION_FAILED'>` directly with `context.phase = 'validate'` so the
 * `createIntent` catch block can short-circuit via `isCreateIntentError` without parsing
 * a string prefix back out of `error.message`.
 *
 * Replaces the legacy pattern of `invariant(cond, msg)` (which throws a generic prefixed
 * Error) followed by `classifyCreateIntentError` to detect the prefix and re-key the code.
 *
 * @example
 *   swapInvariant(supportedToken, `Unsupported spoke chain token: ${token}`);
 *   swapInvariant(amount > 546n, 'BTC dust amount', { field: 'minOutputAmount' });
 */
export function swapInvariant(
  cond: unknown,
  message: string,
  context?: Partial<SwapErrorContext>,
): asserts cond {
  assertOk(
    cond,
    () =>
      new SodaxError('SWAP_VALIDATION_FAILED', message, {
        context: { phase: 'validate', ...context },
      }),
  );
}
