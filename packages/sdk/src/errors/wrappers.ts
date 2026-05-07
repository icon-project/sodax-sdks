/**
 * Constructor helpers for the most common {@link SodaxError} shapes.
 *
 * Each wrapper binds a code, a default phase, and the boilerplate of extracting a message from
 * an unknown cause — so service-layer call sites read as
 * `lookupFailed('dex', 'getPoolData', err)` instead of a 6-line `new SodaxError(...)` literal.
 */

import type { SodaxErrorContext, SodaxFeature } from './codes.js';
import { SodaxError } from './SodaxError.js';

/** Extract `error.message` if `error` is an `Error`; otherwise return the fallback. */
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

type Ctx = Partial<SodaxErrorContext>;

/** `LOOKUP_FAILED` for read-only on-chain queries / off-chain config fetches. */
export function lookupFailed(
  feature: SodaxFeature,
  method: string,
  cause: unknown,
  context?: Ctx,
): SodaxError<'LOOKUP_FAILED'> {
  return new SodaxError('LOOKUP_FAILED', messageOf(cause, `${method} failed`), {
    feature,
    cause,
    context: { phase: 'lookup', method, ...context },
  });
}

/** `TX_VERIFICATION_FAILED` — spoke `verifyTxHash` returned false / threw. */
export function verifyFailed(
  feature: SodaxFeature,
  cause: unknown,
  context?: Ctx,
): SodaxError<'TX_VERIFICATION_FAILED'> {
  return new SodaxError('TX_VERIFICATION_FAILED', 'Spoke transaction verification failed', {
    feature,
    cause,
    context: { phase: 'verify', ...context },
  });
}

/** `INTENT_CREATION_FAILED` — spoke deposit / sendMessage / intent build failed. */
export function intentCreationFailed(
  feature: SodaxFeature,
  cause: unknown,
  context?: Ctx,
): SodaxError<'INTENT_CREATION_FAILED'> {
  return new SodaxError('INTENT_CREATION_FAILED', messageOf(cause, 'Intent creation failed'), {
    feature,
    cause,
    context: { phase: 'intentCreation', ...context },
  });
}

/** `EXECUTION_FAILED` — orchestrator-level catch-all. `context.action` discriminates the op. */
export function executionFailed(
  feature: SodaxFeature,
  cause: unknown,
  context?: Ctx,
): SodaxError<'EXECUTION_FAILED'> {
  return new SodaxError('EXECUTION_FAILED', messageOf(cause, 'Execution failed'), {
    feature,
    cause,
    context: { phase: 'execution', ...context },
  });
}

/** `APPROVE_FAILED` — token approval call failed. */
export function approveFailed(feature: SodaxFeature, cause: unknown, context?: Ctx): SodaxError<'APPROVE_FAILED'> {
  return new SodaxError('APPROVE_FAILED', messageOf(cause, 'Approve failed'), {
    feature,
    cause,
    context: { phase: 'approve', ...context },
  });
}

/** `ALLOWANCE_CHECK_FAILED` — reading on-chain allowance failed. */
export function allowanceCheckFailed(
  feature: SodaxFeature,
  cause: unknown,
  context?: Ctx,
): SodaxError<'ALLOWANCE_CHECK_FAILED'> {
  return new SodaxError('ALLOWANCE_CHECK_FAILED', messageOf(cause, 'Allowance check failed'), {
    feature,
    cause,
    context: { phase: 'allowanceCheck', ...context },
  });
}

/** `GAS_ESTIMATION_FAILED` — gas estimation call failed. */
export function gasEstimationFailed(
  feature: SodaxFeature,
  cause: unknown,
  context?: Ctx,
): SodaxError<'GAS_ESTIMATION_FAILED'> {
  return new SodaxError('GAS_ESTIMATION_FAILED', messageOf(cause, 'Gas estimation failed'), {
    feature,
    cause,
    context: { phase: 'gasEstimation', ...context },
  });
}

/** `UNKNOWN` — last-resort outer catch when no narrower code applies. */
export function unknownFailed(feature: SodaxFeature, cause: unknown, context?: Ctx): SodaxError<'UNKNOWN'> {
  return new SodaxError('UNKNOWN', messageOf(cause, 'Unknown failure'), {
    feature,
    cause,
    context,
  });
}
