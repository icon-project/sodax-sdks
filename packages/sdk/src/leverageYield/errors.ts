/**
 * leverageYield module narrow error types.
 *
 * User-facing actions discriminated by `context.action`:
 *   `'xdeposit' | 'xwithdraw' | 'deposit' | 'withdraw' | 'approve'`.
 * Read-only methods emit `LOOKUP_FAILED` partitioned by `context.method`.
 */

import {
  ALLOWANCE_CHECK_CODES,
  type AllowanceCheckErrorCode,
  APPROVE_CODES,
  type ApproveErrorCode,
  CREATE_INTENT_CODES,
  type CreateIntentErrorCode,
  LOOKUP_CODES,
  type LookupErrorCode,
  type SodaxErrorCode,
} from '../errors/codes.js';
import { isCodeMember } from '../errors/guards.js';
import { createInvariant, type FeatureInvariant } from '../errors/invariant.js';
import type { SodaxError } from '../errors/SodaxError.js';

export const leverageYieldInvariant: FeatureInvariant = createInvariant('leverageYield');

export type LeverageYieldAction = 'xdeposit' | 'xwithdraw' | 'deposit' | 'withdraw' | 'approve';

/** Codes emitted by the cross-chain orchestrators (`xdeposit` / `xwithdraw`). */
export type LeverageYieldOrchestrationErrorCode = Extract<
  SodaxErrorCode,
  | 'VALIDATION_FAILED'
  | 'INTENT_CREATION_FAILED'
  | 'TX_VERIFICATION_FAILED'
  | 'TX_SUBMIT_FAILED'
  | 'RELAY_TIMEOUT'
  | 'RELAY_FAILED'
  | 'EXECUTION_FAILED'
  | 'UNKNOWN'
>;

/** Codes emitted by Sonic-direct `deposit` / `withdraw` (no relay phase). */
export type LeverageYieldDirectErrorCode = Extract<
  SodaxErrorCode,
  'VALIDATION_FAILED' | 'EXECUTION_FAILED' | 'UNKNOWN'
>;

export type LeverageYieldCreateIntentErrorCode = CreateIntentErrorCode;
export type LeverageYieldApproveErrorCode = ApproveErrorCode;
export type LeverageYieldAllowanceCheckErrorCode = AllowanceCheckErrorCode;
export type LeverageYieldLookupErrorCode = LookupErrorCode;

export type LeverageYieldErrorCode = Extract<
  SodaxErrorCode,
  | 'VALIDATION_FAILED'
  | 'INTENT_CREATION_FAILED'
  | 'TX_VERIFICATION_FAILED'
  | 'TX_SUBMIT_FAILED'
  | 'RELAY_TIMEOUT'
  | 'RELAY_FAILED'
  | 'EXECUTION_FAILED'
  | 'APPROVE_FAILED'
  | 'ALLOWANCE_CHECK_FAILED'
  | 'LOOKUP_FAILED'
  | 'UNKNOWN'
>;

export type LeverageYieldOrchestrationError = SodaxError<LeverageYieldOrchestrationErrorCode>;
export type LeverageYieldDirectError = SodaxError<LeverageYieldDirectErrorCode>;
export type LeverageYieldCreateIntentError = SodaxError<LeverageYieldCreateIntentErrorCode>;
export type LeverageYieldApproveError = SodaxError<LeverageYieldApproveErrorCode>;
export type LeverageYieldAllowanceCheckError = SodaxError<LeverageYieldAllowanceCheckErrorCode>;
export type LeverageYieldLookupError = SodaxError<LeverageYieldLookupErrorCode>;
export type LeverageYieldError = SodaxError<LeverageYieldErrorCode>;

const ORCHESTRATION_CODES: ReadonlySet<LeverageYieldOrchestrationErrorCode> = new Set([
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'TX_VERIFICATION_FAILED',
  'TX_SUBMIT_FAILED',
  'RELAY_TIMEOUT',
  'RELAY_FAILED',
  'EXECUTION_FAILED',
  'UNKNOWN',
]);

const DIRECT_CODES: ReadonlySet<LeverageYieldDirectErrorCode> = new Set([
  'VALIDATION_FAILED',
  'EXECUTION_FAILED',
  'UNKNOWN',
]);

const LEVERAGE_YIELD_CODES: ReadonlySet<LeverageYieldErrorCode> = new Set<LeverageYieldErrorCode>([
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'TX_VERIFICATION_FAILED',
  'TX_SUBMIT_FAILED',
  'RELAY_TIMEOUT',
  'RELAY_FAILED',
  'EXECUTION_FAILED',
  'APPROVE_FAILED',
  'ALLOWANCE_CHECK_FAILED',
  'LOOKUP_FAILED',
  'UNKNOWN',
]);

export const isLeverageYieldOrchestrationError = isCodeMember<LeverageYieldOrchestrationErrorCode>(ORCHESTRATION_CODES);
export const isLeverageYieldDirectError = isCodeMember<LeverageYieldDirectErrorCode>(DIRECT_CODES);
export const isLeverageYieldCreateIntentError = isCodeMember<LeverageYieldCreateIntentErrorCode>(CREATE_INTENT_CODES);
export const isLeverageYieldApproveError = isCodeMember<LeverageYieldApproveErrorCode>(APPROVE_CODES);
export const isLeverageYieldAllowanceCheckError =
  isCodeMember<LeverageYieldAllowanceCheckErrorCode>(ALLOWANCE_CHECK_CODES);
export const isLeverageYieldLookupError = isCodeMember<LeverageYieldLookupErrorCode>(LOOKUP_CODES);
export const isLeverageYieldError = isCodeMember<LeverageYieldErrorCode>(LEVERAGE_YIELD_CODES);
