/**
 * Money Market module error code unions.
 *
 * Every MoneyMarketService method that uses the canonical error shape returns
 * `Result<T, SodaxError<NarrowCode>>` where `NarrowCode` is one of the unions defined here.
 * This gives callers compile-time exhaustive checking on `result.error.code`.
 *
 * **Code naming convention:** module-prefixed SCREAMING_SNAKE_CASE (`MM_*`).
 *
 * Codes are organized into:
 * - `MoneyMarketValidationCode` — preconditions / invariant failures.
 * - `MoneyMarketPhaseCode` — failures of a specific phase or per-operation catch-all.
 *
 * Per-operation codes (`MM_SUPPLY_FAILED`, `MM_BORROW_FAILED`, etc.) mirror the historical
 * pre-v2 taxonomy that the published docs document, so consumers that previously
 * discriminated on per-op codes (e.g. `apps/demo/src/lib/utils.ts`) still get a typed
 * surface — they read `error.code` directly instead of aliasing `error.message`.
 *
 * @see {@link ../errors/SodaxError | SodaxError}
 */

import { isSodaxError, SodaxError } from '../errors/SodaxError.js';
import { assertOk } from '../shared/utils/tiny-invariant.js';

export type MoneyMarketValidationCode = 'MM_VALIDATION_FAILED';

export type MoneyMarketPhaseCode =
  | 'MM_SUPPLY_INTENT_CREATION_FAILED'
  | 'MM_BORROW_INTENT_CREATION_FAILED'
  | 'MM_WITHDRAW_INTENT_CREATION_FAILED'
  | 'MM_REPAY_INTENT_CREATION_FAILED'
  | 'MM_SUPPLY_FAILED'
  | 'MM_BORROW_FAILED'
  | 'MM_WITHDRAW_FAILED'
  | 'MM_REPAY_FAILED'
  | 'MM_VERIFY_FAILED'
  | 'MM_SUBMIT_TX_FAILED'
  | 'MM_RELAY_TIMEOUT'
  | 'MM_RELAY_FAILED'
  | 'MM_APPROVE_FAILED'
  | 'MM_ALLOWANCE_CHECK_FAILED'
  | 'MM_GAS_ESTIMATION_FAILED'
  | 'MM_UNKNOWN';

/** Module-wide superset — useful as a broad guard / external signal. */
export type MoneyMarketErrorCode = MoneyMarketValidationCode | MoneyMarketPhaseCode;

// ─────────────────────────────────────────────────────────────────────────────
// Per-method narrow unions
// ─────────────────────────────────────────────────────────────────────────────

export type CreateSupplyIntentErrorCode =
  | MoneyMarketValidationCode
  | 'MM_SUPPLY_INTENT_CREATION_FAILED'
  | 'MM_UNKNOWN';

export type CreateBorrowIntentErrorCode =
  | MoneyMarketValidationCode
  | 'MM_BORROW_INTENT_CREATION_FAILED'
  | 'MM_UNKNOWN';

export type CreateWithdrawIntentErrorCode =
  | MoneyMarketValidationCode
  | 'MM_WITHDRAW_INTENT_CREATION_FAILED'
  | 'MM_UNKNOWN';

export type CreateRepayIntentErrorCode =
  | MoneyMarketValidationCode
  | 'MM_REPAY_INTENT_CREATION_FAILED'
  | 'MM_UNKNOWN';

/**
 * Codes returned by the high-level orchestrators (`supply`/`borrow`/`withdraw`/`repay`).
 * Includes the matching createIntent code (which they delegate through), the shared
 * relay/verify codes, and the per-op generic catch-all.
 */
export type SupplyErrorCode =
  | MoneyMarketValidationCode
  | 'MM_SUPPLY_INTENT_CREATION_FAILED'
  | 'MM_VERIFY_FAILED'
  | 'MM_SUBMIT_TX_FAILED'
  | 'MM_RELAY_TIMEOUT'
  | 'MM_RELAY_FAILED'
  | 'MM_SUPPLY_FAILED'
  | 'MM_UNKNOWN';

export type BorrowErrorCode =
  | MoneyMarketValidationCode
  | 'MM_BORROW_INTENT_CREATION_FAILED'
  | 'MM_VERIFY_FAILED'
  | 'MM_SUBMIT_TX_FAILED'
  | 'MM_RELAY_TIMEOUT'
  | 'MM_RELAY_FAILED'
  | 'MM_BORROW_FAILED'
  | 'MM_UNKNOWN';

export type WithdrawErrorCode =
  | MoneyMarketValidationCode
  | 'MM_WITHDRAW_INTENT_CREATION_FAILED'
  | 'MM_VERIFY_FAILED'
  | 'MM_SUBMIT_TX_FAILED'
  | 'MM_RELAY_TIMEOUT'
  | 'MM_RELAY_FAILED'
  | 'MM_WITHDRAW_FAILED'
  | 'MM_UNKNOWN';

export type RepayErrorCode =
  | MoneyMarketValidationCode
  | 'MM_REPAY_INTENT_CREATION_FAILED'
  | 'MM_VERIFY_FAILED'
  | 'MM_SUBMIT_TX_FAILED'
  | 'MM_RELAY_TIMEOUT'
  | 'MM_RELAY_FAILED'
  | 'MM_REPAY_FAILED'
  | 'MM_UNKNOWN';

export type MoneyMarketApproveErrorCode = MoneyMarketValidationCode | 'MM_APPROVE_FAILED' | 'MM_UNKNOWN';
export type MoneyMarketAllowanceCheckErrorCode = MoneyMarketValidationCode | 'MM_ALLOWANCE_CHECK_FAILED' | 'MM_UNKNOWN';
export type MoneyMarketGasEstimationErrorCode = MoneyMarketValidationCode | 'MM_GAS_ESTIMATION_FAILED' | 'MM_UNKNOWN';

// ─────────────────────────────────────────────────────────────────────────────
// Standard context shape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 4 user-facing money-market operations. Used as `context.action` so consumers can
 * discriminate which orchestrator was running when a shared relay code fires
 * (`MM_RELAY_TIMEOUT`, `MM_SUBMIT_TX_FAILED`, `MM_RELAY_FAILED`). Defined here (rather than
 * in `MoneyMarketService.ts`) so the relay-error mapper and the error-context type can
 * reference it without creating a `MoneyMarketService.ts → error-types.ts → MoneyMarketService.ts`
 * import cycle.
 */
export type MoneyMarketAction = 'supply' | 'borrow' | 'withdraw' | 'repay';

export type MoneyMarketPhase =
  | 'validate'
  | 'intentCreation'
  | 'verify'
  | 'submit'
  | 'relay'
  | 'approve'
  | 'allowanceCheck'
  | 'gasEstimation';

/**
 * Standard `context` payload attached to MM errors. Concrete fields vary per code.
 *
 * - `srcChainKey` / `dstChainKey` — low-cardinality. Suitable for logger tags / Sentry tags.
 * - `action` — `'supply' | 'borrow' | 'withdraw' | 'repay'`. Set on relay/verify/submit codes
 *   that are shared across all four operations so consumers can tell which one was running.
 * - `phase` — phase tag for filtering by step (validate / intentCreation / verify / etc.).
 * - `relayCode` — only set on `MM_RELAY_TIMEOUT` / `MM_SUBMIT_TX_FAILED` / `MM_RELAY_FAILED`.
 *   Mirrors the relay-layer `RELAY_ERROR_CODES` contract; carries `'RELAY_POLLING_FAILED'`
 *   on `MM_RELAY_FAILED` so consumers can distinguish polling outage from generic failure.
 * - `field` / `reason` — only on `MM_VALIDATION_FAILED` (which precondition tripped).
 */
export type MoneyMarketErrorContext = {
  srcChainKey?: string;
  dstChainKey?: string;
  action?: MoneyMarketAction;
  phase?: MoneyMarketPhase;
  relayCode?: 'SUBMIT_TX_FAILED' | 'RELAY_TIMEOUT' | 'RELAY_POLLING_FAILED' | 'UNKNOWN';
  field?: string;
  reason?: string;
  [key: string]: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-method error type aliases
// ─────────────────────────────────────────────────────────────────────────────

export type CreateSupplyIntentError = SodaxError<CreateSupplyIntentErrorCode>;
export type CreateBorrowIntentError = SodaxError<CreateBorrowIntentErrorCode>;
export type CreateWithdrawIntentError = SodaxError<CreateWithdrawIntentErrorCode>;
export type CreateRepayIntentError = SodaxError<CreateRepayIntentErrorCode>;
export type SupplyError = SodaxError<SupplyErrorCode>;
export type BorrowError = SodaxError<BorrowErrorCode>;
export type WithdrawError = SodaxError<WithdrawErrorCode>;
export type RepayError = SodaxError<RepayErrorCode>;
export type MoneyMarketApproveError = SodaxError<MoneyMarketApproveErrorCode>;
export type MoneyMarketAllowanceCheckError = SodaxError<MoneyMarketAllowanceCheckErrorCode>;
export type MoneyMarketGasEstimationError = SodaxError<MoneyMarketGasEstimationErrorCode>;
export type MoneyMarketError = SodaxError<MoneyMarketErrorCode>;

// ─────────────────────────────────────────────────────────────────────────────
// Runtime code sets — kept in lockstep with union types via `satisfies`
// ─────────────────────────────────────────────────────────────────────────────
// The `as XError` cast after a generic `isSodaxError` check would silently widen the
// contract — a future throw of e.g. `SodaxError<'MM_RELAY_TIMEOUT'>` from inside
// `createSupplyIntent` would propagate as a `CreateSupplyIntentError` at compile time.
// Membership-checked guards prevent that drift.

const CREATE_SUPPLY_INTENT_CODES = new Set<string>([
  'MM_VALIDATION_FAILED',
  'MM_SUPPLY_INTENT_CREATION_FAILED',
  'MM_UNKNOWN',
] satisfies CreateSupplyIntentErrorCode[]);

const CREATE_BORROW_INTENT_CODES = new Set<string>([
  'MM_VALIDATION_FAILED',
  'MM_BORROW_INTENT_CREATION_FAILED',
  'MM_UNKNOWN',
] satisfies CreateBorrowIntentErrorCode[]);

const CREATE_WITHDRAW_INTENT_CODES = new Set<string>([
  'MM_VALIDATION_FAILED',
  'MM_WITHDRAW_INTENT_CREATION_FAILED',
  'MM_UNKNOWN',
] satisfies CreateWithdrawIntentErrorCode[]);

const CREATE_REPAY_INTENT_CODES = new Set<string>([
  'MM_VALIDATION_FAILED',
  'MM_REPAY_INTENT_CREATION_FAILED',
  'MM_UNKNOWN',
] satisfies CreateRepayIntentErrorCode[]);

const SUPPLY_CODES = new Set<string>([
  'MM_VALIDATION_FAILED',
  'MM_SUPPLY_INTENT_CREATION_FAILED',
  'MM_VERIFY_FAILED',
  'MM_SUBMIT_TX_FAILED',
  'MM_RELAY_TIMEOUT',
  'MM_RELAY_FAILED',
  'MM_SUPPLY_FAILED',
  'MM_UNKNOWN',
] satisfies SupplyErrorCode[]);

const BORROW_CODES = new Set<string>([
  'MM_VALIDATION_FAILED',
  'MM_BORROW_INTENT_CREATION_FAILED',
  'MM_VERIFY_FAILED',
  'MM_SUBMIT_TX_FAILED',
  'MM_RELAY_TIMEOUT',
  'MM_RELAY_FAILED',
  'MM_BORROW_FAILED',
  'MM_UNKNOWN',
] satisfies BorrowErrorCode[]);

const WITHDRAW_CODES = new Set<string>([
  'MM_VALIDATION_FAILED',
  'MM_WITHDRAW_INTENT_CREATION_FAILED',
  'MM_VERIFY_FAILED',
  'MM_SUBMIT_TX_FAILED',
  'MM_RELAY_TIMEOUT',
  'MM_RELAY_FAILED',
  'MM_WITHDRAW_FAILED',
  'MM_UNKNOWN',
] satisfies WithdrawErrorCode[]);

const REPAY_CODES = new Set<string>([
  'MM_VALIDATION_FAILED',
  'MM_REPAY_INTENT_CREATION_FAILED',
  'MM_VERIFY_FAILED',
  'MM_SUBMIT_TX_FAILED',
  'MM_RELAY_TIMEOUT',
  'MM_RELAY_FAILED',
  'MM_REPAY_FAILED',
  'MM_UNKNOWN',
] satisfies RepayErrorCode[]);

const APPROVE_CODES = new Set<string>([
  'MM_VALIDATION_FAILED',
  'MM_APPROVE_FAILED',
  'MM_UNKNOWN',
] satisfies MoneyMarketApproveErrorCode[]);

const ALLOWANCE_CHECK_CODES = new Set<string>([
  'MM_VALIDATION_FAILED',
  'MM_ALLOWANCE_CHECK_FAILED',
  'MM_UNKNOWN',
] satisfies MoneyMarketAllowanceCheckErrorCode[]);

const GAS_ESTIMATION_CODES = new Set<string>([
  'MM_VALIDATION_FAILED',
  'MM_GAS_ESTIMATION_FAILED',
  'MM_UNKNOWN',
] satisfies MoneyMarketGasEstimationErrorCode[]);

const MONEY_MARKET_CODES = new Set<string>([
  'MM_VALIDATION_FAILED',
  'MM_SUPPLY_INTENT_CREATION_FAILED',
  'MM_BORROW_INTENT_CREATION_FAILED',
  'MM_WITHDRAW_INTENT_CREATION_FAILED',
  'MM_REPAY_INTENT_CREATION_FAILED',
  'MM_SUPPLY_FAILED',
  'MM_BORROW_FAILED',
  'MM_WITHDRAW_FAILED',
  'MM_REPAY_FAILED',
  'MM_VERIFY_FAILED',
  'MM_SUBMIT_TX_FAILED',
  'MM_RELAY_TIMEOUT',
  'MM_RELAY_FAILED',
  'MM_APPROVE_FAILED',
  'MM_ALLOWANCE_CHECK_FAILED',
  'MM_GAS_ESTIMATION_FAILED',
  'MM_UNKNOWN',
] satisfies MoneyMarketErrorCode[]);

// ─────────────────────────────────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────────────────────────────────

/** Type guard for any code in the MoneyMarket module's union. */
export function isMoneyMarketError(e: unknown): e is MoneyMarketError {
  return isSodaxError(e) && MONEY_MARKET_CODES.has(e.code);
}

export function isCreateSupplyIntentError(e: unknown): e is CreateSupplyIntentError {
  return isSodaxError(e) && CREATE_SUPPLY_INTENT_CODES.has(e.code);
}
export function isCreateBorrowIntentError(e: unknown): e is CreateBorrowIntentError {
  return isSodaxError(e) && CREATE_BORROW_INTENT_CODES.has(e.code);
}
export function isCreateWithdrawIntentError(e: unknown): e is CreateWithdrawIntentError {
  return isSodaxError(e) && CREATE_WITHDRAW_INTENT_CODES.has(e.code);
}
export function isCreateRepayIntentError(e: unknown): e is CreateRepayIntentError {
  return isSodaxError(e) && CREATE_REPAY_INTENT_CODES.has(e.code);
}

export function isSupplyError(e: unknown): e is SupplyError {
  return isSodaxError(e) && SUPPLY_CODES.has(e.code);
}
export function isBorrowError(e: unknown): e is BorrowError {
  return isSodaxError(e) && BORROW_CODES.has(e.code);
}
export function isWithdrawError(e: unknown): e is WithdrawError {
  return isSodaxError(e) && WITHDRAW_CODES.has(e.code);
}
export function isRepayError(e: unknown): e is RepayError {
  return isSodaxError(e) && REPAY_CODES.has(e.code);
}

export function isMoneyMarketApproveError(e: unknown): e is MoneyMarketApproveError {
  return isSodaxError(e) && APPROVE_CODES.has(e.code);
}
export function isMoneyMarketAllowanceCheckError(e: unknown): e is MoneyMarketAllowanceCheckError {
  return isSodaxError(e) && ALLOWANCE_CHECK_CODES.has(e.code);
}
export function isMoneyMarketGasEstimationError(e: unknown): e is MoneyMarketGasEstimationError {
  return isSodaxError(e) && GAS_ESTIMATION_CODES.has(e.code);
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation invariant
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Precondition assertion for MoneyMarket-module methods. Throws
 * `SodaxError<'MM_VALIDATION_FAILED'>` directly with `context.phase = 'validate'` so the
 * surrounding catch block can short-circuit via `is<Op>Error` without parsing a string
 * prefix back out of `error.message`.
 *
 * Mirrors `swapInvariant` in the swap module.
 *
 * @example
 *   mmInvariant(amount > 0n, 'Amount must be greater than 0', { field: 'amount' });
 *   mmInvariant(supportedToken, `Unsupported spoke chain (${chain}) token: ${token}`,
 *     { srcChainKey: chain, field: 'token' });
 */
export function mmInvariant(
  cond: unknown,
  message: string,
  context?: Partial<MoneyMarketErrorContext>,
): asserts cond {
  assertOk(
    cond,
    () =>
      new SodaxError('MM_VALIDATION_FAILED', message, {
        context: { phase: 'validate', ...context },
      }),
  );
}
