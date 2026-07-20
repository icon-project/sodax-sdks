// Gasless module narrow error types for its public actions (getCapabilities/prepare/submit/sendCalls/relay).

import type { GaslessApiErrorCode } from '@sodax/types';
import type { SodaxErrorCode } from '../errors/codes.js';
import { isCodeMember } from '../errors/guards.js';
import { createInvariant, type FeatureInvariant } from '../errors/invariant.js';
import type { SodaxError } from '../errors/SodaxError.js';

export const gaslessInvariant: FeatureInvariant = createInvariant('gasless');

export type GaslessAction = 'getCapabilities' | 'prepare' | 'submit' | 'sendCalls' | 'relay';

export type GaslessOrchestrationErrorCode = Extract<
  SodaxErrorCode,
  | 'USER_REJECTED'
  | 'VALIDATION_FAILED'
  | 'GAS_ESTIMATION_FAILED'
  | 'TX_SUBMIT_FAILED'
  | 'TX_VERIFICATION_FAILED'
  | 'RELAY_TIMEOUT'
  | 'RELAY_FAILED'
  | 'EXECUTION_FAILED'
  | 'UNKNOWN'
>;

export type GaslessOrchestrationError = SodaxError<GaslessOrchestrationErrorCode>;
export type GaslessLookupError = SodaxError<Extract<SodaxErrorCode, 'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'UNKNOWN'>>;

const ORCHESTRATION_CODES: ReadonlySet<GaslessOrchestrationErrorCode> = new Set([
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'GAS_ESTIMATION_FAILED',
  'TX_SUBMIT_FAILED',
  'TX_VERIFICATION_FAILED',
  'RELAY_TIMEOUT',
  'RELAY_FAILED',
  'EXECUTION_FAILED',
  'UNKNOWN',
]);

export const isGaslessOrchestrationError = isCodeMember<GaslessOrchestrationErrorCode>(ORCHESTRATION_CODES);

/** Runtime view of the {@link GaslessApiErrorCode} wire enum — the single source consumers/tests share. */
export const GASLESS_API_ERROR_CODES = [
  'CHAIN_NOT_CONFIGURED',
  'SENDER_NOT_EOA',
  'INVALID_TOKEN',
  'SPONSORSHIP_UNAVAILABLE',
  'SIGNATURE_MISMATCH',
  'BUNDLER_REJECTED',
  'INVALID_REQUEST',
  'INTERNAL_ERROR',
] as const satisfies readonly GaslessApiErrorCode[];

const GASLESS_API_ERROR_CODE_SET: ReadonlySet<string> = new Set(GASLESS_API_ERROR_CODES);

/** True when `value` is a valid {@link GaslessApiErrorCode}. */
export function isGaslessApiErrorCode(value: unknown): value is GaslessApiErrorCode {
  return typeof value === 'string' && GASLESS_API_ERROR_CODE_SET.has(value);
}

/** Map a brain {@link SodaxError} to the JSON-safe {@link GaslessApiErrorCode} a backend returns over HTTP, so each backend does not hand-roll the taxonomy. */
export function toGaslessApiErrorCode(error: SodaxError): GaslessApiErrorCode {
  if (isGaslessApiErrorCode(error.context?.reason)) return error.context.reason;
  if (error.code === 'VALIDATION_FAILED') {
    switch (error.context?.field) {
      case 'srcAddress':
        return 'SENDER_NOT_EOA';
      case 'token':
        return 'INVALID_TOKEN';
      case 'srcChainKey':
        return 'CHAIN_NOT_CONFIGURED';
      default:
        return 'INVALID_REQUEST';
    }
  }
  if (error.code === 'TX_SUBMIT_FAILED') return 'BUNDLER_REJECTED';
  // `prepare` wraps ERC-4337 gas-estimation failures — a bundler/paymaster rejection during
  // `eth_estimateUserOperationGas` (sponsorship declined, op reverts in simulation, bundler down) — as
  // GAS_ESTIMATION_FAILED. Surface it as an upstream bundler rejection (502), matching `submit`'s
  // TX_SUBMIT_FAILED, rather than an opaque INTERNAL_ERROR (500) that reads as a server fault.
  if (error.code === 'GAS_ESTIMATION_FAILED') return 'BUNDLER_REJECTED';
  return 'INTERNAL_ERROR';
}

/**
 * Suggested HTTP status per {@link GaslessApiErrorCode}, so a backend fulfilling the gasless wire
 * contract over HTTP does not hand-roll the table. Pair with {@link toGaslessApiErrorCode}: put the wire code in
 * the response body (the SDK client keeps it only when it is a valid `GaslessApiErrorCode`) and use this
 * for the status — `gaslessApiErrorCodeToHttpStatus[toGaslessApiErrorCode(error)] ?? 500`. Backends can
 * override; `422` (well-formed but unsponsorable) and `502` (upstream bundler rejection) are the opinionated ones.
 */
export const gaslessApiErrorCodeToHttpStatus = {
  CHAIN_NOT_CONFIGURED: 400,
  SENDER_NOT_EOA: 400,
  INVALID_TOKEN: 400,
  SPONSORSHIP_UNAVAILABLE: 422,
  SIGNATURE_MISMATCH: 400,
  BUNDLER_REJECTED: 502,
  INVALID_REQUEST: 400,
  INTERNAL_ERROR: 500,
} as const satisfies Record<GaslessApiErrorCode, number>;
