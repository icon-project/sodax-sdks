/**
 * Gasless module narrow error types.
 *
 * Single user-facing action (`'deposit'`). The batch runs as one sponsored operation (Mode B user
 * operation / Mode A `wallet_sendCalls`), so there is no standalone `approve` surface — but the
 * opt-in gas-fallback path does approve+deposit, so `APPROVE_FAILED` / `ALLOWANCE_CHECK_FAILED` are
 * reachable there. `getGaslessCapabilities` is a read-only lookup (`LOOKUP_FAILED`).
 */

import type { SodaxErrorCode } from '../errors/codes.js';
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
  | 'APPROVE_FAILED'
  | 'ALLOWANCE_CHECK_FAILED'
  | 'UNKNOWN'
>;

export type GaslessOrchestrationError = SodaxError<GaslessOrchestrationErrorCode>;
export type GaslessLookupError = SodaxError<Extract<SodaxErrorCode, 'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'UNKNOWN'>>;

const ORCHESTRATION_CODES: ReadonlySet<GaslessOrchestrationErrorCode> = new Set([
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'TX_VERIFICATION_FAILED',
  'TX_SUBMIT_FAILED',
  'RELAY_TIMEOUT',
  'RELAY_FAILED',
  'EXECUTION_FAILED',
  'APPROVE_FAILED',
  'ALLOWANCE_CHECK_FAILED',
  'UNKNOWN',
]);

export const isGaslessOrchestrationError = isCodeMember<GaslessOrchestrationErrorCode>(ORCHESTRATION_CODES);
