/**
 * Gasless module narrow error types.
 *
 * Single user-facing action (`'deposit'`). The batched approve+transfer is executed as one
 * sponsored EIP-7702 user operation, so there is no separate `approve` / `isAllowanceValid`
 * surface — the reachable codes are the create-intent subset plus the orchestration (relay)
 * codes, mirroring `bridge/errors.ts` minus the approve/allowance/lookup variants.
 */

import { CREATE_INTENT_CODES, type CreateIntentErrorCode, type SodaxErrorCode } from '../errors/codes.js';
import { isCodeMember } from '../errors/guards.js';
import { createInvariant, type FeatureInvariant } from '../errors/invariant.js';
import type { SodaxError } from '../errors/SodaxError.js';

export const gaslessInvariant: FeatureInvariant = createInvariant('gasless');

export type GaslessAction = 'deposit';

export type GaslessOrchestrationErrorCode = Extract<
  SodaxErrorCode,
  | 'USER_REJECTED'
  | 'VALIDATION_FAILED'
  | 'INTENT_CREATION_FAILED'
  | 'TX_VERIFICATION_FAILED'
  | 'TX_SUBMIT_FAILED'
  | 'RELAY_TIMEOUT'
  | 'RELAY_FAILED'
  | 'EXECUTION_FAILED'
  | 'UNKNOWN'
>;

export type GaslessCreateIntentErrorCode = CreateIntentErrorCode;

export type GaslessOrchestrationError = SodaxError<GaslessOrchestrationErrorCode>;
export type GaslessCreateIntentError = SodaxError<GaslessCreateIntentErrorCode>;
export type GaslessError = GaslessOrchestrationError;

const ORCHESTRATION_CODES: ReadonlySet<GaslessOrchestrationErrorCode> = new Set([
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'TX_VERIFICATION_FAILED',
  'TX_SUBMIT_FAILED',
  'RELAY_TIMEOUT',
  'RELAY_FAILED',
  'EXECUTION_FAILED',
  'UNKNOWN',
]);

export const isGaslessOrchestrationError = isCodeMember<GaslessOrchestrationErrorCode>(ORCHESTRATION_CODES);
export const isGaslessCreateIntentError = isCodeMember<GaslessCreateIntentErrorCode>(CREATE_INTENT_CODES);
