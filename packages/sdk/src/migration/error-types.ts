/**
 * Migration module error code unions.
 *
 * Every MigrationService method (and `IcxMigrationService.getAvailableAmount`) that uses the
 * canonical error shape returns `Result<T, SodaxError<NarrowCode>>` where `NarrowCode` is
 * one of the unions defined here. Callers get compile-time exhaustive checking on
 * `result.error.code`.
 *
 * **Code naming convention:** module-prefixed SCREAMING_SNAKE_CASE (`MIGRATION_*`).
 *
 * Codes are organized into:
 * - `MigrationValidationCode` — preconditions / invariant failures.
 * - `MigrationPhaseCode` — failures of a specific phase or per-direction catch-all.
 *
 * The historical pre-v2 published taxonomy (`MIGRATION_FAILED`, `CREATE_MIGRATION_INTENT_FAILED`,
 * `REVERT_MIGRATION_FAILED`, `CREATE_REVERT_MIGRATION_INTENT_FAILED`) is restored here in a typed,
 * runtime-checked form. The migrate/revert split is preserved; per-op fan-out (bnUSD vs ICX vs
 * BALN) is delegated to `context.action` rather than minting per-op codes — faithful to v1
 * which did not distinguish sub-modules.
 *
 * @see {@link ../errors/SodaxError | SodaxError}
 */

import { isSodaxError, SodaxError } from '../errors/SodaxError.js';
import { assertOk } from '../shared/utils/tiny-invariant.js';

export type MigrationValidationCode = 'MIGRATION_VALIDATION_FAILED';

export type MigrationPhaseCode =
  // intent-creation, migrate vs revert split (mirrors v1)
  | 'MIGRATION_INTENT_CREATION_FAILED'
  | 'MIGRATION_REVERT_INTENT_CREATION_FAILED'
  // orchestrator catch-alls (mirrors v1 MIGRATION_FAILED / REVERT_MIGRATION_FAILED)
  | 'MIGRATION_FAILED'
  | 'MIGRATION_REVERT_FAILED'
  // shared phase tags (action discriminator on context.action)
  | 'MIGRATION_VERIFY_FAILED'                  // spoke tx verification (only migratebnUSD calls verifyTxHash)
  | 'MIGRATION_SUBMIT_TX_FAILED'
  | 'MIGRATION_RELAY_TIMEOUT'
  | 'MIGRATION_RELAY_FAILED'
  // approve / lookup
  | 'MIGRATION_APPROVE_FAILED'
  | 'MIGRATION_ALLOWANCE_CHECK_FAILED'
  | 'MIGRATION_LOOKUP_FAILED'
  | 'MIGRATION_UNKNOWN';

/** Module-wide superset — useful as a broad guard / external signal. */
export type MigrationErrorCode = MigrationValidationCode | MigrationPhaseCode;

// ─────────────────────────────────────────────────────────────────────────────
// Per-method narrow unions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Codes returned by the 3 forward orchestrators (`migratebnUSD`, `migrateIcxToSoda`,
 * `migrateBaln`). Includes validation, intent creation (delegated through the matching
 * `create*Intent`), the shared relay codes, and the per-direction generic catch-all.
 */
export type MigrateOrchestrationErrorCode =
  | MigrationValidationCode
  | 'MIGRATION_INTENT_CREATION_FAILED'
  | 'MIGRATION_VERIFY_FAILED'
  | 'MIGRATION_SUBMIT_TX_FAILED'
  | 'MIGRATION_RELAY_TIMEOUT'
  | 'MIGRATION_RELAY_FAILED'
  | 'MIGRATION_FAILED'
  | 'MIGRATION_UNKNOWN';

/** Codes returned by the lone reverse orchestrator (`revertMigrateSodaToIcx`). */
export type RevertMigrationOrchestrationErrorCode =
  | MigrationValidationCode
  | 'MIGRATION_REVERT_INTENT_CREATION_FAILED'
  | 'MIGRATION_SUBMIT_TX_FAILED'
  | 'MIGRATION_RELAY_TIMEOUT'
  | 'MIGRATION_RELAY_FAILED'
  | 'MIGRATION_REVERT_FAILED'
  | 'MIGRATION_UNKNOWN';

export type CreateMigrateIntentErrorCode =
  | MigrationValidationCode
  | 'MIGRATION_INTENT_CREATION_FAILED'
  | 'MIGRATION_UNKNOWN';

export type CreateRevertMigrationIntentErrorCode =
  | MigrationValidationCode
  | 'MIGRATION_REVERT_INTENT_CREATION_FAILED'
  | 'MIGRATION_UNKNOWN';

export type MigrationApproveErrorCode = MigrationValidationCode | 'MIGRATION_APPROVE_FAILED' | 'MIGRATION_UNKNOWN';
export type MigrationAllowanceCheckErrorCode =
  | MigrationValidationCode
  | 'MIGRATION_ALLOWANCE_CHECK_FAILED'
  | 'MIGRATION_UNKNOWN';
export type MigrationLookupErrorCode = MigrationValidationCode | 'MIGRATION_LOOKUP_FAILED' | 'MIGRATION_UNKNOWN';

// ─────────────────────────────────────────────────────────────────────────────
// Standard context shape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 4 user-facing migration orchestrators. Used as `context.action` so consumers can
 * discriminate which orchestrator was running when a shared relay code fires
 * (`MIGRATION_RELAY_TIMEOUT`, `MIGRATION_SUBMIT_TX_FAILED`, etc.).
 */
export type MigrationOp = 'migratebnUSD' | 'migrateIcxToSoda' | 'revertMigrateSodaToIcx' | 'migrateBaln';

/**
 * Direction of `migratebnUSD` execution at runtime. Forward = legacy bnUSD → new bnUSD;
 * reverse = new bnUSD → legacy bnUSD. The error code stays `MIGRATION_FAILED` regardless
 * (the method name says "migrate") — `direction` is purely a forensics/logging hint.
 * Other actions don't set `direction`.
 */
export type MigrationDirection = 'forward' | 'reverse';

export type MigrationPhase =
  | 'validate'
  | 'intentCreation'
  | 'verify'
  | 'submit'
  | 'relay'
  | 'destinationExecution'
  | 'approve'
  | 'allowanceCheck'
  | 'lookup';

/**
 * Standard `context` payload attached to migration errors. Concrete fields vary per code.
 *
 * - `srcChainKey` / `dstChainKey` — low-cardinality. Suitable for logger / Sentry tags.
 * - `action` — `'migratebnUSD' | 'migrateIcxToSoda' | 'revertMigrateSodaToIcx' | 'migrateBaln'`.
 *   Required on relay/submit codes that are shared across the 4 orchestrators so consumers
 *   can tell which one was running.
 * - `direction` — only set on `migratebnUSD` errors. Distinguishes forward (legacy → new)
 *   from reverse (new → legacy).
 * - `phase` — phase tag. `'destinationExecution'` is set on `MIGRATION_RELAY_*` errors that
 *   originate from the secondary `waitUntilIntentExecuted` call inside `migratebnUSD`
 *   (vs. `'relay'` for the primary `relayTxAndWaitPacket` call). Avoids minting a 5th relay
 *   code while keeping the two phases queryable in logs.
 * - `relayCode` — only set on `MIGRATION_RELAY_TIMEOUT` / `MIGRATION_SUBMIT_TX_FAILED` /
 *   `MIGRATION_RELAY_FAILED`. Mirrors the relay-layer `RELAY_ERROR_CODES` contract; carries
 *   `'RELAY_POLLING_FAILED'` on `MIGRATION_RELAY_FAILED`.
 * - `field` / `reason` — only on `MIGRATION_VALIDATION_FAILED` (which precondition tripped).
 */
export type MigrationErrorContext = {
  srcChainKey?: string;
  dstChainKey?: string;
  action?: MigrationOp;
  direction?: MigrationDirection;
  phase?: MigrationPhase;
  relayCode?: 'SUBMIT_TX_FAILED' | 'RELAY_TIMEOUT' | 'RELAY_POLLING_FAILED' | 'UNKNOWN';
  field?: string;
  reason?: string;
  [key: string]: unknown;
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-method error type aliases
// ─────────────────────────────────────────────────────────────────────────────

export type MigrateOrchestrationError = SodaxError<MigrateOrchestrationErrorCode>;
export type RevertMigrationOrchestrationError = SodaxError<RevertMigrationOrchestrationErrorCode>;
export type CreateMigrateIntentError = SodaxError<CreateMigrateIntentErrorCode>;
export type CreateRevertMigrationIntentError = SodaxError<CreateRevertMigrationIntentErrorCode>;
export type MigrationApproveError = SodaxError<MigrationApproveErrorCode>;
export type MigrationAllowanceCheckError = SodaxError<MigrationAllowanceCheckErrorCode>;
export type MigrationLookupError = SodaxError<MigrationLookupErrorCode>;
export type MigrationError = SodaxError<MigrationErrorCode>;

// ─────────────────────────────────────────────────────────────────────────────
// Runtime code sets — kept in lockstep with union types via `satisfies`
// ─────────────────────────────────────────────────────────────────────────────
// The `as XError` cast after a generic `isSodaxError` check would silently widen the
// contract — a future throw of e.g. `SodaxError<'MIGRATION_REVERT_FAILED'>` from inside
// a forward orchestrator would propagate as a `MigrateOrchestrationError` at compile time.
// Membership-checked guards prevent that drift.

const MIGRATE_ORCH_CODES = new Set<string>([
  'MIGRATION_VALIDATION_FAILED',
  'MIGRATION_INTENT_CREATION_FAILED',
  'MIGRATION_VERIFY_FAILED',
  'MIGRATION_SUBMIT_TX_FAILED',
  'MIGRATION_RELAY_TIMEOUT',
  'MIGRATION_RELAY_FAILED',
  'MIGRATION_FAILED',
  'MIGRATION_UNKNOWN',
] satisfies MigrateOrchestrationErrorCode[]);

const REVERT_ORCH_CODES = new Set<string>([
  'MIGRATION_VALIDATION_FAILED',
  'MIGRATION_REVERT_INTENT_CREATION_FAILED',
  'MIGRATION_SUBMIT_TX_FAILED',
  'MIGRATION_RELAY_TIMEOUT',
  'MIGRATION_RELAY_FAILED',
  'MIGRATION_REVERT_FAILED',
  'MIGRATION_UNKNOWN',
] satisfies RevertMigrationOrchestrationErrorCode[]);

const CREATE_MIGRATE_INTENT_CODES = new Set<string>([
  'MIGRATION_VALIDATION_FAILED',
  'MIGRATION_INTENT_CREATION_FAILED',
  'MIGRATION_UNKNOWN',
] satisfies CreateMigrateIntentErrorCode[]);

const CREATE_REVERT_INTENT_CODES = new Set<string>([
  'MIGRATION_VALIDATION_FAILED',
  'MIGRATION_REVERT_INTENT_CREATION_FAILED',
  'MIGRATION_UNKNOWN',
] satisfies CreateRevertMigrationIntentErrorCode[]);

const APPROVE_CODES = new Set<string>([
  'MIGRATION_VALIDATION_FAILED',
  'MIGRATION_APPROVE_FAILED',
  'MIGRATION_UNKNOWN',
] satisfies MigrationApproveErrorCode[]);

const ALLOWANCE_CHECK_CODES = new Set<string>([
  'MIGRATION_VALIDATION_FAILED',
  'MIGRATION_ALLOWANCE_CHECK_FAILED',
  'MIGRATION_UNKNOWN',
] satisfies MigrationAllowanceCheckErrorCode[]);

const LOOKUP_CODES = new Set<string>([
  'MIGRATION_VALIDATION_FAILED',
  'MIGRATION_LOOKUP_FAILED',
  'MIGRATION_UNKNOWN',
] satisfies MigrationLookupErrorCode[]);

const MIGRATION_ERROR_CODES = new Set<string>([
  'MIGRATION_VALIDATION_FAILED',
  'MIGRATION_INTENT_CREATION_FAILED',
  'MIGRATION_REVERT_INTENT_CREATION_FAILED',
  'MIGRATION_FAILED',
  'MIGRATION_REVERT_FAILED',
  'MIGRATION_VERIFY_FAILED',
  'MIGRATION_SUBMIT_TX_FAILED',
  'MIGRATION_RELAY_TIMEOUT',
  'MIGRATION_RELAY_FAILED',
  'MIGRATION_APPROVE_FAILED',
  'MIGRATION_ALLOWANCE_CHECK_FAILED',
  'MIGRATION_LOOKUP_FAILED',
  'MIGRATION_UNKNOWN',
] satisfies MigrationErrorCode[]);

// ─────────────────────────────────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────────────────────────────────

/** Type guard for any code in the Migration module's union. */
export function isMigrationError(e: unknown): e is MigrationError {
  return isSodaxError(e) && MIGRATION_ERROR_CODES.has(e.code);
}

export function isMigrateOrchestrationError(e: unknown): e is MigrateOrchestrationError {
  return isSodaxError(e) && MIGRATE_ORCH_CODES.has(e.code);
}

export function isRevertMigrationOrchestrationError(e: unknown): e is RevertMigrationOrchestrationError {
  return isSodaxError(e) && REVERT_ORCH_CODES.has(e.code);
}

export function isCreateMigrateIntentError(e: unknown): e is CreateMigrateIntentError {
  return isSodaxError(e) && CREATE_MIGRATE_INTENT_CODES.has(e.code);
}

export function isCreateRevertMigrationIntentError(e: unknown): e is CreateRevertMigrationIntentError {
  return isSodaxError(e) && CREATE_REVERT_INTENT_CODES.has(e.code);
}

export function isMigrationApproveError(e: unknown): e is MigrationApproveError {
  return isSodaxError(e) && APPROVE_CODES.has(e.code);
}

export function isMigrationAllowanceCheckError(e: unknown): e is MigrationAllowanceCheckError {
  return isSodaxError(e) && ALLOWANCE_CHECK_CODES.has(e.code);
}

export function isMigrationLookupError(e: unknown): e is MigrationLookupError {
  return isSodaxError(e) && LOOKUP_CODES.has(e.code);
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation invariant
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Precondition assertion for Migration-module methods. Throws
 * `SodaxError<'MIGRATION_VALIDATION_FAILED'>` directly with `context.phase = 'validate'` so the
 * surrounding catch block can short-circuit via `is<Op>Error` without parsing a string
 * prefix back out of `error.message`.
 *
 * Mirrors `swapInvariant`, `mmInvariant`, `bridgeInvariant`, `stakingInvariant`.
 *
 * @example
 *   migrationInvariant(amount > 0n, 'Amount must be greater than 0', { field: 'amount' });
 *   migrationInvariant(supportedToken, `Unsupported token`,
 *     { srcChainKey, action: 'migrateIcxToSoda', field: 'token' });
 */
export function migrationInvariant(
  cond: unknown,
  message: string,
  context?: Partial<MigrationErrorContext>,
): asserts cond {
  assertOk(
    cond,
    () =>
      new SodaxError('MIGRATION_VALIDATION_FAILED', message, {
        context: { phase: 'validate', ...context },
      }),
  );
}
