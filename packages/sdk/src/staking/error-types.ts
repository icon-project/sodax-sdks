/**
 * Staking module error code unions.
 *
 * Every StakingService method that uses the canonical error shape returns
 * `Result<T, SodaxError<NarrowCode>>` where `NarrowCode` is one of the unions defined here.
 * This gives callers compile-time exhaustive checking on `result.error.code`.
 *
 * **Code naming convention:** module-prefixed SCREAMING_SNAKE_CASE (`STAKING_*`).
 *
 * Codes are organized into:
 * - `StakingValidationCode` — preconditions / invariant failures.
 * - `StakingPhaseCode` — failures of a specific phase or per-operation catch-all.
 *
 * Per-operation codes (`STAKING_STAKE_FAILED`, `STAKING_UNSTAKE_FAILED`, etc.) mirror the
 * historical pre-v2 taxonomy that the published docs document, so consumers that previously
 * discriminated on per-op codes still get a typed surface — they read `error.code` directly
 * instead of aliasing `error.message`.
 *
 * @see {@link ../errors/SodaxError | SodaxError}
 */

import { isSodaxError, SodaxError } from '../errors/SodaxError.js';
import { assertOk } from '../shared/utils/tiny-invariant.js';

/**
 * The 5 user-facing staking operations. Used as `context.action` so consumers can
 * discriminate which orchestrator was running when a shared relay code fires
 * (`STAKING_RELAY_TIMEOUT`, `STAKING_SUBMIT_TX_FAILED`, `STAKING_RELAY_FAILED`). Defined
 * here (rather than in `StakingService.ts`) so the relay-error mapper and the
 * error-context type can reference it without creating a
 * `StakingService.ts → error-types.ts → StakingService.ts` import cycle.
 */
export type StakingActionType = 'stake' | 'unstake' | 'claim' | 'cancelUnstake' | 'instantUnstake';

export type StakingValidationCode = 'STAKING_VALIDATION_FAILED';

export type StakingPhaseCode =
  // intent-creation per-op
  | 'STAKING_STAKE_INTENT_CREATION_FAILED'
  | 'STAKING_UNSTAKE_INTENT_CREATION_FAILED'
  | 'STAKING_INSTANT_UNSTAKE_INTENT_CREATION_FAILED'
  | 'STAKING_CLAIM_INTENT_CREATION_FAILED'
  | 'STAKING_CANCEL_UNSTAKE_INTENT_CREATION_FAILED'
  // orchestrator catch-alls (mirrors v1 STAKE_FAILED / etc.)
  | 'STAKING_STAKE_FAILED'
  | 'STAKING_UNSTAKE_FAILED'
  | 'STAKING_INSTANT_UNSTAKE_FAILED'
  | 'STAKING_CLAIM_FAILED'
  | 'STAKING_CANCEL_UNSTAKE_FAILED'
  // shared phase tags
  | 'STAKING_VERIFY_FAILED'
  | 'STAKING_SUBMIT_TX_FAILED'
  | 'STAKING_RELAY_TIMEOUT'
  | 'STAKING_RELAY_FAILED'
  // approve / lookup
  | 'STAKING_APPROVE_FAILED'
  | 'STAKING_ALLOWANCE_CHECK_FAILED'
  | 'STAKING_INFO_FETCH_FAILED'
  | 'STAKING_UNKNOWN';

/** Module-wide superset — useful as a broad guard / external signal. */
export type StakingErrorCode = StakingValidationCode | StakingPhaseCode;

// ─────────────────────────────────────────────────────────────────────────────
// Per-method narrow unions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Codes returned by the high-level `stake` orchestrator. Stake is the only orchestrator
 * that calls `spoke.verifyTxHash`, so `STAKING_VERIFY_FAILED` appears only here.
 */
export type StakeErrorCode =
  | StakingValidationCode
  | 'STAKING_STAKE_INTENT_CREATION_FAILED'
  | 'STAKING_VERIFY_FAILED'
  | 'STAKING_SUBMIT_TX_FAILED'
  | 'STAKING_RELAY_TIMEOUT'
  | 'STAKING_RELAY_FAILED'
  | 'STAKING_STAKE_FAILED'
  | 'STAKING_UNKNOWN';

export type UnstakeErrorCode =
  | StakingValidationCode
  | 'STAKING_UNSTAKE_INTENT_CREATION_FAILED'
  | 'STAKING_SUBMIT_TX_FAILED'
  | 'STAKING_RELAY_TIMEOUT'
  | 'STAKING_RELAY_FAILED'
  | 'STAKING_UNSTAKE_FAILED'
  | 'STAKING_UNKNOWN';

export type InstantUnstakeErrorCode =
  | StakingValidationCode
  | 'STAKING_INSTANT_UNSTAKE_INTENT_CREATION_FAILED'
  | 'STAKING_SUBMIT_TX_FAILED'
  | 'STAKING_RELAY_TIMEOUT'
  | 'STAKING_RELAY_FAILED'
  | 'STAKING_INSTANT_UNSTAKE_FAILED'
  | 'STAKING_UNKNOWN';

export type ClaimErrorCode =
  | StakingValidationCode
  | 'STAKING_CLAIM_INTENT_CREATION_FAILED'
  | 'STAKING_SUBMIT_TX_FAILED'
  | 'STAKING_RELAY_TIMEOUT'
  | 'STAKING_RELAY_FAILED'
  | 'STAKING_CLAIM_FAILED'
  | 'STAKING_UNKNOWN';

export type CancelUnstakeErrorCode =
  | StakingValidationCode
  | 'STAKING_CANCEL_UNSTAKE_INTENT_CREATION_FAILED'
  | 'STAKING_SUBMIT_TX_FAILED'
  | 'STAKING_RELAY_TIMEOUT'
  | 'STAKING_RELAY_FAILED'
  | 'STAKING_CANCEL_UNSTAKE_FAILED'
  | 'STAKING_UNKNOWN';

export type CreateStakeIntentErrorCode =
  | StakingValidationCode
  | 'STAKING_STAKE_INTENT_CREATION_FAILED'
  | 'STAKING_UNKNOWN';

export type CreateUnstakeIntentErrorCode =
  | StakingValidationCode
  | 'STAKING_UNSTAKE_INTENT_CREATION_FAILED'
  | 'STAKING_UNKNOWN';

export type CreateInstantUnstakeIntentErrorCode =
  | StakingValidationCode
  | 'STAKING_INSTANT_UNSTAKE_INTENT_CREATION_FAILED'
  | 'STAKING_UNKNOWN';

export type CreateClaimIntentErrorCode =
  | StakingValidationCode
  | 'STAKING_CLAIM_INTENT_CREATION_FAILED'
  | 'STAKING_UNKNOWN';

export type CreateCancelUnstakeIntentErrorCode =
  | StakingValidationCode
  | 'STAKING_CANCEL_UNSTAKE_INTENT_CREATION_FAILED'
  | 'STAKING_UNKNOWN';

export type StakingApproveErrorCode = StakingValidationCode | 'STAKING_APPROVE_FAILED' | 'STAKING_UNKNOWN';
export type StakingAllowanceCheckErrorCode =
  | StakingValidationCode
  | 'STAKING_ALLOWANCE_CHECK_FAILED'
  | 'STAKING_UNKNOWN';
export type StakingInfoFetchErrorCode = StakingValidationCode | 'STAKING_INFO_FETCH_FAILED' | 'STAKING_UNKNOWN';

// ─────────────────────────────────────────────────────────────────────────────
// Standard context shape
// ─────────────────────────────────────────────────────────────────────────────

export type StakingPhase =
  | 'validate'
  | 'intentCreation'
  | 'verify'
  | 'submit'
  | 'relay'
  | 'approve'
  | 'allowanceCheck'
  | 'infoFetch';

/**
 * Standard `context` payload attached to staking errors. Concrete fields vary per code.
 *
 * - `srcChainKey` — low-cardinality. Suitable for logger tags / Sentry tags. Destination
 *   is always Sonic for staking, so no `dstChainKey`.
 * - `action` — `'stake' | 'unstake' | 'instantUnstake' | 'claim' | 'cancelUnstake'`. Set on
 *   relay/verify/submit codes that are shared across all five orchestrators so consumers can
 *   tell which one was running.
 * - `phase` — phase tag for filtering by step.
 * - `relayCode` — only set on `STAKING_RELAY_TIMEOUT` / `STAKING_SUBMIT_TX_FAILED` /
 *   `STAKING_RELAY_FAILED`. Mirrors the relay-layer `RELAY_ERROR_CODES` contract; carries
 *   `'RELAY_POLLING_FAILED'` on `STAKING_RELAY_FAILED` so consumers can distinguish polling
 *   outage from generic failure.
 * - `field` / `reason` — only on `STAKING_VALIDATION_FAILED` (which precondition tripped).
 * - `method` — only on `STAKING_INFO_FETCH_FAILED`. Names the read-only method the failure
 *   came from (`'getStakingInfo'`, `'getUnstakingInfo'`, etc.) so the 8 readers can be
 *   partitioned without minting per-method codes.
 */
export type StakingErrorContext = {
  srcChainKey?: string;
  action?: StakingActionType;
  phase?: StakingPhase;
  relayCode?: 'SUBMIT_TX_FAILED' | 'RELAY_TIMEOUT' | 'RELAY_POLLING_FAILED' | 'UNKNOWN';
  field?: string;
  reason?: string;
  method?: string;
  [key: string]: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-method error type aliases
// ─────────────────────────────────────────────────────────────────────────────

export type StakeError = SodaxError<StakeErrorCode>;
export type UnstakeError = SodaxError<UnstakeErrorCode>;
export type InstantUnstakeError = SodaxError<InstantUnstakeErrorCode>;
export type ClaimError = SodaxError<ClaimErrorCode>;
export type CancelUnstakeError = SodaxError<CancelUnstakeErrorCode>;
export type CreateStakeIntentError = SodaxError<CreateStakeIntentErrorCode>;
export type CreateUnstakeIntentError = SodaxError<CreateUnstakeIntentErrorCode>;
export type CreateInstantUnstakeIntentError = SodaxError<CreateInstantUnstakeIntentErrorCode>;
export type CreateClaimIntentError = SodaxError<CreateClaimIntentErrorCode>;
export type CreateCancelUnstakeIntentError = SodaxError<CreateCancelUnstakeIntentErrorCode>;
export type StakingApproveError = SodaxError<StakingApproveErrorCode>;
export type StakingAllowanceCheckError = SodaxError<StakingAllowanceCheckErrorCode>;
export type StakingInfoFetchError = SodaxError<StakingInfoFetchErrorCode>;
export type StakingError = SodaxError<StakingErrorCode>;

// ─────────────────────────────────────────────────────────────────────────────
// Runtime code sets — kept in lockstep with union types via `satisfies`
// ─────────────────────────────────────────────────────────────────────────────
// The `as XError` cast after a generic `isSodaxError` check would silently widen the
// contract — a future throw of e.g. `SodaxError<'STAKING_RELAY_TIMEOUT'>` from inside
// `createStakeIntent` would propagate as a `CreateStakeIntentError` at compile time.
// Membership-checked guards prevent that drift.

const STAKE_CODES = new Set<string>([
  'STAKING_VALIDATION_FAILED',
  'STAKING_STAKE_INTENT_CREATION_FAILED',
  'STAKING_VERIFY_FAILED',
  'STAKING_SUBMIT_TX_FAILED',
  'STAKING_RELAY_TIMEOUT',
  'STAKING_RELAY_FAILED',
  'STAKING_STAKE_FAILED',
  'STAKING_UNKNOWN',
] satisfies StakeErrorCode[]);

const UNSTAKE_CODES = new Set<string>([
  'STAKING_VALIDATION_FAILED',
  'STAKING_UNSTAKE_INTENT_CREATION_FAILED',
  'STAKING_SUBMIT_TX_FAILED',
  'STAKING_RELAY_TIMEOUT',
  'STAKING_RELAY_FAILED',
  'STAKING_UNSTAKE_FAILED',
  'STAKING_UNKNOWN',
] satisfies UnstakeErrorCode[]);

const INSTANT_UNSTAKE_CODES = new Set<string>([
  'STAKING_VALIDATION_FAILED',
  'STAKING_INSTANT_UNSTAKE_INTENT_CREATION_FAILED',
  'STAKING_SUBMIT_TX_FAILED',
  'STAKING_RELAY_TIMEOUT',
  'STAKING_RELAY_FAILED',
  'STAKING_INSTANT_UNSTAKE_FAILED',
  'STAKING_UNKNOWN',
] satisfies InstantUnstakeErrorCode[]);

const CLAIM_CODES = new Set<string>([
  'STAKING_VALIDATION_FAILED',
  'STAKING_CLAIM_INTENT_CREATION_FAILED',
  'STAKING_SUBMIT_TX_FAILED',
  'STAKING_RELAY_TIMEOUT',
  'STAKING_RELAY_FAILED',
  'STAKING_CLAIM_FAILED',
  'STAKING_UNKNOWN',
] satisfies ClaimErrorCode[]);

const CANCEL_UNSTAKE_CODES = new Set<string>([
  'STAKING_VALIDATION_FAILED',
  'STAKING_CANCEL_UNSTAKE_INTENT_CREATION_FAILED',
  'STAKING_SUBMIT_TX_FAILED',
  'STAKING_RELAY_TIMEOUT',
  'STAKING_RELAY_FAILED',
  'STAKING_CANCEL_UNSTAKE_FAILED',
  'STAKING_UNKNOWN',
] satisfies CancelUnstakeErrorCode[]);

const CREATE_STAKE_INTENT_CODES = new Set<string>([
  'STAKING_VALIDATION_FAILED',
  'STAKING_STAKE_INTENT_CREATION_FAILED',
  'STAKING_UNKNOWN',
] satisfies CreateStakeIntentErrorCode[]);

const CREATE_UNSTAKE_INTENT_CODES = new Set<string>([
  'STAKING_VALIDATION_FAILED',
  'STAKING_UNSTAKE_INTENT_CREATION_FAILED',
  'STAKING_UNKNOWN',
] satisfies CreateUnstakeIntentErrorCode[]);

const CREATE_INSTANT_UNSTAKE_INTENT_CODES = new Set<string>([
  'STAKING_VALIDATION_FAILED',
  'STAKING_INSTANT_UNSTAKE_INTENT_CREATION_FAILED',
  'STAKING_UNKNOWN',
] satisfies CreateInstantUnstakeIntentErrorCode[]);

const CREATE_CLAIM_INTENT_CODES = new Set<string>([
  'STAKING_VALIDATION_FAILED',
  'STAKING_CLAIM_INTENT_CREATION_FAILED',
  'STAKING_UNKNOWN',
] satisfies CreateClaimIntentErrorCode[]);

const CREATE_CANCEL_UNSTAKE_INTENT_CODES = new Set<string>([
  'STAKING_VALIDATION_FAILED',
  'STAKING_CANCEL_UNSTAKE_INTENT_CREATION_FAILED',
  'STAKING_UNKNOWN',
] satisfies CreateCancelUnstakeIntentErrorCode[]);

const APPROVE_CODES = new Set<string>([
  'STAKING_VALIDATION_FAILED',
  'STAKING_APPROVE_FAILED',
  'STAKING_UNKNOWN',
] satisfies StakingApproveErrorCode[]);

const ALLOWANCE_CHECK_CODES = new Set<string>([
  'STAKING_VALIDATION_FAILED',
  'STAKING_ALLOWANCE_CHECK_FAILED',
  'STAKING_UNKNOWN',
] satisfies StakingAllowanceCheckErrorCode[]);

const INFO_FETCH_CODES = new Set<string>([
  'STAKING_VALIDATION_FAILED',
  'STAKING_INFO_FETCH_FAILED',
  'STAKING_UNKNOWN',
] satisfies StakingInfoFetchErrorCode[]);

const STAKING_ERROR_CODES = new Set<string>([
  'STAKING_VALIDATION_FAILED',
  'STAKING_STAKE_INTENT_CREATION_FAILED',
  'STAKING_UNSTAKE_INTENT_CREATION_FAILED',
  'STAKING_INSTANT_UNSTAKE_INTENT_CREATION_FAILED',
  'STAKING_CLAIM_INTENT_CREATION_FAILED',
  'STAKING_CANCEL_UNSTAKE_INTENT_CREATION_FAILED',
  'STAKING_STAKE_FAILED',
  'STAKING_UNSTAKE_FAILED',
  'STAKING_INSTANT_UNSTAKE_FAILED',
  'STAKING_CLAIM_FAILED',
  'STAKING_CANCEL_UNSTAKE_FAILED',
  'STAKING_VERIFY_FAILED',
  'STAKING_SUBMIT_TX_FAILED',
  'STAKING_RELAY_TIMEOUT',
  'STAKING_RELAY_FAILED',
  'STAKING_APPROVE_FAILED',
  'STAKING_ALLOWANCE_CHECK_FAILED',
  'STAKING_INFO_FETCH_FAILED',
  'STAKING_UNKNOWN',
] satisfies StakingErrorCode[]);

// ─────────────────────────────────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────────────────────────────────

/** Type guard for any code in the Staking module's union. */
export function isStakingError(e: unknown): e is StakingError {
  return isSodaxError(e) && STAKING_ERROR_CODES.has(e.code);
}

export function isStakeError(e: unknown): e is StakeError {
  return isSodaxError(e) && STAKE_CODES.has(e.code);
}
export function isUnstakeError(e: unknown): e is UnstakeError {
  return isSodaxError(e) && UNSTAKE_CODES.has(e.code);
}
export function isInstantUnstakeError(e: unknown): e is InstantUnstakeError {
  return isSodaxError(e) && INSTANT_UNSTAKE_CODES.has(e.code);
}
export function isClaimError(e: unknown): e is ClaimError {
  return isSodaxError(e) && CLAIM_CODES.has(e.code);
}
export function isCancelUnstakeError(e: unknown): e is CancelUnstakeError {
  return isSodaxError(e) && CANCEL_UNSTAKE_CODES.has(e.code);
}

export function isCreateStakeIntentError(e: unknown): e is CreateStakeIntentError {
  return isSodaxError(e) && CREATE_STAKE_INTENT_CODES.has(e.code);
}
export function isCreateUnstakeIntentError(e: unknown): e is CreateUnstakeIntentError {
  return isSodaxError(e) && CREATE_UNSTAKE_INTENT_CODES.has(e.code);
}
export function isCreateInstantUnstakeIntentError(e: unknown): e is CreateInstantUnstakeIntentError {
  return isSodaxError(e) && CREATE_INSTANT_UNSTAKE_INTENT_CODES.has(e.code);
}
export function isCreateClaimIntentError(e: unknown): e is CreateClaimIntentError {
  return isSodaxError(e) && CREATE_CLAIM_INTENT_CODES.has(e.code);
}
export function isCreateCancelUnstakeIntentError(e: unknown): e is CreateCancelUnstakeIntentError {
  return isSodaxError(e) && CREATE_CANCEL_UNSTAKE_INTENT_CODES.has(e.code);
}

export function isStakingApproveError(e: unknown): e is StakingApproveError {
  return isSodaxError(e) && APPROVE_CODES.has(e.code);
}
export function isStakingAllowanceCheckError(e: unknown): e is StakingAllowanceCheckError {
  return isSodaxError(e) && ALLOWANCE_CHECK_CODES.has(e.code);
}
export function isStakingInfoFetchError(e: unknown): e is StakingInfoFetchError {
  return isSodaxError(e) && INFO_FETCH_CODES.has(e.code);
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation invariant
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Precondition assertion for Staking-module methods. Throws
 * `SodaxError<'STAKING_VALIDATION_FAILED'>` directly with `context.phase = 'validate'` so the
 * surrounding catch block can short-circuit via `is<Op>Error` without parsing a string
 * prefix back out of `error.message`.
 *
 * Mirrors `swapInvariant`, `mmInvariant`, and `bridgeInvariant`.
 *
 * @example
 *   stakingInvariant(amount > 0n, 'Amount must be greater than 0', { field: 'amount' });
 *   stakingInvariant(sodaToken, 'SODA token not found',
 *     { srcChainKey, field: 'sodaToken' });
 */
export function stakingInvariant(
  cond: unknown,
  message: string,
  context?: Partial<StakingErrorContext>,
): asserts cond {
  assertOk(
    cond,
    () =>
      new SodaxError('STAKING_VALIDATION_FAILED', message, {
        context: { phase: 'validate', ...context },
      }),
  );
}
