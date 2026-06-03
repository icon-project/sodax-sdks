/**
 * leverageYield module narrow error types.
 *
 * The service is a thin layer over the solver and the hub: `deposit` / `withdraw` build
 * `CreateIntentParams` (the caller relays them via `swaps.swap()`), `approve` /
 * `isAllowanceValid` manage the underlying-asset allowance on Sonic, and the read methods
 * query on-chain state. There is no in-service relay/tx-verification step, so the emitted
 * codes are limited to the create-intent, approve, allowance-check and lookup subsets.
 *
 * User-facing actions discriminated by `context.action`: `'deposit' | 'withdraw' | 'approve'`.
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

export type LeverageYieldAction = 'deposit' | 'withdraw' | 'approve' | 'allowanceCheck';

export type LeverageYieldCreateIntentErrorCode = CreateIntentErrorCode;
export type LeverageYieldApproveErrorCode = ApproveErrorCode;
export type LeverageYieldAllowanceCheckErrorCode = AllowanceCheckErrorCode;
export type LeverageYieldLookupErrorCode = LookupErrorCode;

export type LeverageYieldErrorCode = Extract<
  SodaxErrorCode,
  | 'VALIDATION_FAILED'
  | 'INTENT_CREATION_FAILED'
  | 'APPROVE_FAILED'
  | 'ALLOWANCE_CHECK_FAILED'
  | 'LOOKUP_FAILED'
  | 'UNKNOWN'
>;

export type LeverageYieldCreateIntentError = SodaxError<LeverageYieldCreateIntentErrorCode>;
export type LeverageYieldApproveError = SodaxError<LeverageYieldApproveErrorCode>;
export type LeverageYieldAllowanceCheckError = SodaxError<LeverageYieldAllowanceCheckErrorCode>;
export type LeverageYieldLookupError = SodaxError<LeverageYieldLookupErrorCode>;
export type LeverageYieldError = SodaxError<LeverageYieldErrorCode>;

const LEVERAGE_YIELD_CODES: ReadonlySet<LeverageYieldErrorCode> = new Set<LeverageYieldErrorCode>([
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'APPROVE_FAILED',
  'ALLOWANCE_CHECK_FAILED',
  'LOOKUP_FAILED',
  'UNKNOWN',
]);

export const isLeverageYieldCreateIntentError = isCodeMember<LeverageYieldCreateIntentErrorCode>(CREATE_INTENT_CODES);
export const isLeverageYieldApproveError = isCodeMember<LeverageYieldApproveErrorCode>(APPROVE_CODES);
export const isLeverageYieldAllowanceCheckError =
  isCodeMember<LeverageYieldAllowanceCheckErrorCode>(ALLOWANCE_CHECK_CODES);
export const isLeverageYieldLookupError = isCodeMember<LeverageYieldLookupErrorCode>(LOOKUP_CODES);
export const isLeverageYieldError = isCodeMember<LeverageYieldErrorCode>(LEVERAGE_YIELD_CODES);
