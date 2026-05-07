/**
 * Bridge module error code unions.
 *
 * Every BridgeService method that uses the canonical error shape returns
 * `Result<T, SodaxError<NarrowCode>>` where `NarrowCode` is one of the unions defined here.
 * This gives callers compile-time exhaustive checking on `result.error.code`.
 *
 * **Code naming convention:** module-prefixed SCREAMING_SNAKE_CASE (`BRIDGE_*`).
 *
 * Codes are organized into:
 * - `BridgeValidationCode` — preconditions / invariant failures.
 * - `BridgePhaseCode` — failures of a specific phase or per-method catch-all.
 *
 * The historical pre-v2 `BridgeError<Code>` taxonomy (4 codes: `ALLOWANCE_CHECK_FAILED`,
 * `APPROVAL_FAILED`, `CREATE_BRIDGE_INTENT_FAILED`, `BRIDGE_FAILED`) is restored here in a
 * typed, runtime-checked form with module-prefixed names. See `docs/BRIDGE.md` for the
 * migration table.
 *
 * @see {@link ../errors/SodaxError | SodaxError}
 */

import { isSodaxError, SodaxError } from '../errors/SodaxError.js';
import { assertOk } from '../shared/utils/tiny-invariant.js';

export type BridgeValidationCode = 'BRIDGE_VALIDATION_FAILED';

export type BridgePhaseCode =
  | 'BRIDGE_INTENT_CREATION_FAILED'
  | 'BRIDGE_VERIFY_FAILED'
  | 'BRIDGE_SUBMIT_TX_FAILED'
  | 'BRIDGE_RELAY_TIMEOUT'
  | 'BRIDGE_RELAY_FAILED'
  | 'BRIDGE_FAILED'
  | 'BRIDGE_APPROVE_FAILED'
  | 'BRIDGE_ALLOWANCE_CHECK_FAILED'
  | 'BRIDGE_GET_BRIDGEABLE_AMOUNT_FAILED'
  | 'BRIDGE_GET_BRIDGEABLE_TOKENS_FAILED'
  | 'BRIDGE_UNKNOWN';

/** Module-wide superset — useful as a broad guard / external signal. */
export type BridgeErrorCode = BridgeValidationCode | BridgePhaseCode;

// ─────────────────────────────────────────────────────────────────────────────
// Per-method narrow unions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Codes returned by the high-level `bridge` orchestrator. Includes validation, intent
 * creation (delegated through `createBridgeIntent`), spoke verify, the shared relay
 * codes, and the per-method generic catch-all.
 */
export type BridgeOrchestrationErrorCode =
  | BridgeValidationCode
  | 'BRIDGE_INTENT_CREATION_FAILED'
  | 'BRIDGE_VERIFY_FAILED'
  | 'BRIDGE_SUBMIT_TX_FAILED'
  | 'BRIDGE_RELAY_TIMEOUT'
  | 'BRIDGE_RELAY_FAILED'
  | 'BRIDGE_FAILED'
  | 'BRIDGE_UNKNOWN';

export type CreateBridgeIntentErrorCode =
  | BridgeValidationCode
  | 'BRIDGE_INTENT_CREATION_FAILED'
  | 'BRIDGE_UNKNOWN';

export type BridgeApproveErrorCode = BridgeValidationCode | 'BRIDGE_APPROVE_FAILED' | 'BRIDGE_UNKNOWN';
export type BridgeAllowanceCheckErrorCode = BridgeValidationCode | 'BRIDGE_ALLOWANCE_CHECK_FAILED' | 'BRIDGE_UNKNOWN';
export type GetBridgeableAmountErrorCode =
  | BridgeValidationCode
  | 'BRIDGE_GET_BRIDGEABLE_AMOUNT_FAILED'
  | 'BRIDGE_UNKNOWN';
export type GetBridgeableTokensErrorCode =
  | BridgeValidationCode
  | 'BRIDGE_GET_BRIDGEABLE_TOKENS_FAILED'
  | 'BRIDGE_UNKNOWN';

// ─────────────────────────────────────────────────────────────────────────────
// Standard context shape
// ─────────────────────────────────────────────────────────────────────────────

export type BridgePhase =
  | 'validate'
  | 'intentCreation'
  | 'verify'
  | 'submit'
  | 'relay'
  | 'approve'
  | 'allowanceCheck'
  | 'lookup';

/**
 * Standard `context` payload attached to bridge errors. Concrete fields vary per code.
 *
 * - `srcChainKey` / `dstChainKey` — low-cardinality. Suitable for logger tags / Sentry tags.
 * - `phase` — phase tag for filtering by step.
 * - `relayCode` — only set on `BRIDGE_RELAY_TIMEOUT` / `BRIDGE_SUBMIT_TX_FAILED` /
 *   `BRIDGE_RELAY_FAILED`. Mirrors the relay-layer `RELAY_ERROR_CODES` contract; carries
 *   `'RELAY_POLLING_FAILED'` on `BRIDGE_RELAY_FAILED` so consumers can distinguish polling
 *   outage from generic failure.
 * - `field` / `reason` — only on `BRIDGE_VALIDATION_FAILED` (which precondition tripped).
 */
export type BridgeErrorContext = {
  srcChainKey?: string;
  dstChainKey?: string;
  phase?: BridgePhase;
  relayCode?: 'SUBMIT_TX_FAILED' | 'RELAY_TIMEOUT' | 'RELAY_POLLING_FAILED' | 'UNKNOWN';
  field?: string;
  reason?: string;
  [key: string]: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-method error type aliases
// ─────────────────────────────────────────────────────────────────────────────

export type BridgeOrchestrationError = SodaxError<BridgeOrchestrationErrorCode>;
export type CreateBridgeIntentError = SodaxError<CreateBridgeIntentErrorCode>;
export type BridgeApproveError = SodaxError<BridgeApproveErrorCode>;
export type BridgeAllowanceCheckError = SodaxError<BridgeAllowanceCheckErrorCode>;
export type GetBridgeableAmountError = SodaxError<GetBridgeableAmountErrorCode>;
export type GetBridgeableTokensError = SodaxError<GetBridgeableTokensErrorCode>;
export type BridgeError = SodaxError<BridgeErrorCode>;

// ─────────────────────────────────────────────────────────────────────────────
// Runtime code sets — kept in lockstep with union types via `satisfies`
// ─────────────────────────────────────────────────────────────────────────────

const ORCHESTRATION_CODES = new Set<string>([
  'BRIDGE_VALIDATION_FAILED',
  'BRIDGE_INTENT_CREATION_FAILED',
  'BRIDGE_VERIFY_FAILED',
  'BRIDGE_SUBMIT_TX_FAILED',
  'BRIDGE_RELAY_TIMEOUT',
  'BRIDGE_RELAY_FAILED',
  'BRIDGE_FAILED',
  'BRIDGE_UNKNOWN',
] satisfies BridgeOrchestrationErrorCode[]);

const CREATE_BRIDGE_INTENT_CODES = new Set<string>([
  'BRIDGE_VALIDATION_FAILED',
  'BRIDGE_INTENT_CREATION_FAILED',
  'BRIDGE_UNKNOWN',
] satisfies CreateBridgeIntentErrorCode[]);

const APPROVE_CODES = new Set<string>([
  'BRIDGE_VALIDATION_FAILED',
  'BRIDGE_APPROVE_FAILED',
  'BRIDGE_UNKNOWN',
] satisfies BridgeApproveErrorCode[]);

const ALLOWANCE_CHECK_CODES = new Set<string>([
  'BRIDGE_VALIDATION_FAILED',
  'BRIDGE_ALLOWANCE_CHECK_FAILED',
  'BRIDGE_UNKNOWN',
] satisfies BridgeAllowanceCheckErrorCode[]);

const GET_BRIDGEABLE_AMOUNT_CODES = new Set<string>([
  'BRIDGE_VALIDATION_FAILED',
  'BRIDGE_GET_BRIDGEABLE_AMOUNT_FAILED',
  'BRIDGE_UNKNOWN',
] satisfies GetBridgeableAmountErrorCode[]);

const GET_BRIDGEABLE_TOKENS_CODES = new Set<string>([
  'BRIDGE_VALIDATION_FAILED',
  'BRIDGE_GET_BRIDGEABLE_TOKENS_FAILED',
  'BRIDGE_UNKNOWN',
] satisfies GetBridgeableTokensErrorCode[]);

const BRIDGE_ERROR_CODES = new Set<string>([
  'BRIDGE_VALIDATION_FAILED',
  'BRIDGE_INTENT_CREATION_FAILED',
  'BRIDGE_VERIFY_FAILED',
  'BRIDGE_SUBMIT_TX_FAILED',
  'BRIDGE_RELAY_TIMEOUT',
  'BRIDGE_RELAY_FAILED',
  'BRIDGE_FAILED',
  'BRIDGE_APPROVE_FAILED',
  'BRIDGE_ALLOWANCE_CHECK_FAILED',
  'BRIDGE_GET_BRIDGEABLE_AMOUNT_FAILED',
  'BRIDGE_GET_BRIDGEABLE_TOKENS_FAILED',
  'BRIDGE_UNKNOWN',
] satisfies BridgeErrorCode[]);

// ─────────────────────────────────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────────────────────────────────

/** Type guard for any code in the Bridge module's union. */
export function isBridgeError(e: unknown): e is BridgeError {
  return isSodaxError(e) && BRIDGE_ERROR_CODES.has(e.code);
}

export function isBridgeOrchestrationError(e: unknown): e is BridgeOrchestrationError {
  return isSodaxError(e) && ORCHESTRATION_CODES.has(e.code);
}

export function isCreateBridgeIntentError(e: unknown): e is CreateBridgeIntentError {
  return isSodaxError(e) && CREATE_BRIDGE_INTENT_CODES.has(e.code);
}

export function isBridgeApproveError(e: unknown): e is BridgeApproveError {
  return isSodaxError(e) && APPROVE_CODES.has(e.code);
}

export function isBridgeAllowanceCheckError(e: unknown): e is BridgeAllowanceCheckError {
  return isSodaxError(e) && ALLOWANCE_CHECK_CODES.has(e.code);
}

export function isGetBridgeableAmountError(e: unknown): e is GetBridgeableAmountError {
  return isSodaxError(e) && GET_BRIDGEABLE_AMOUNT_CODES.has(e.code);
}

export function isGetBridgeableTokensError(e: unknown): e is GetBridgeableTokensError {
  return isSodaxError(e) && GET_BRIDGEABLE_TOKENS_CODES.has(e.code);
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation invariant
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Precondition assertion for Bridge-module methods. Throws
 * `SodaxError<'BRIDGE_VALIDATION_FAILED'>` directly with `context.phase = 'validate'` so the
 * surrounding catch block can short-circuit via `is<Op>Error` without parsing a string
 * prefix back out of `error.message`.
 *
 * Mirrors `swapInvariant` and `mmInvariant`.
 *
 * @example
 *   bridgeInvariant(amount > 0n, 'Amount must be greater than 0', { field: 'amount' });
 *   bridgeInvariant(supportedToken, `Unsupported spoke chain token: ${token}`,
 *     { srcChainKey, field: 'srcToken' });
 */
export function bridgeInvariant(
  cond: unknown,
  message: string,
  context?: Partial<BridgeErrorContext>,
): asserts cond {
  assertOk(
    cond,
    () =>
      new SodaxError('BRIDGE_VALIDATION_FAILED', message, {
        context: { phase: 'validate', ...context },
      }),
  );
}
