/**
 * Type-guard helpers for the unified {@link SodaxError} system.
 *
 * - {@link isFeatureError} — narrows by `feature` field for cross-feature consumer code.
 * - {@link isCodeMember} — builds a per-method narrow guard from a `Set` of codes. Per-feature
 *   `errors.ts` modules use this to expose `isSupplyError`, `isCreateSwapIntentError`, etc.
 *
 * The base {@link isSodaxError} guard lives in `./SodaxError` so it ships next to the class.
 */

import type { SodaxError } from './SodaxError.js';
import { isSodaxError } from './SodaxError.js';
import type { SodaxErrorCode, SodaxFeature } from './codes.js';

/**
 * Returns a guard that narrows `unknown` to a `SodaxError` produced by a specific feature.
 *
 * @example
 *   const isSwapError = isFeatureError('swap');
 *   if (isSwapError(err)) { ... }
 */
export function isFeatureError<F extends SodaxFeature>(feature: F) {
  return (e: unknown): e is SodaxError & { feature: F } => isSodaxError(e) && e.feature === feature;
}

/**
 * Returns a guard that narrows to a `SodaxError<C>` whose code is in the given set.
 * Used by per-feature `errors.ts` modules to build per-method guards
 * (`isSupplyError`, `isCreateSwapIntentError`, etc.) without writing one function per code list.
 *
 * @example
 *   const SUPPLY_CODES = new Set([
 *     'VALIDATION_FAILED', 'INTENT_CREATION_FAILED', 'TX_VERIFICATION_FAILED',
 *     'TX_SUBMIT_FAILED', 'RELAY_TIMEOUT', 'RELAY_FAILED', 'EXECUTION_FAILED', 'UNKNOWN',
 *   ] as const satisfies SupplyErrorCode[]) as ReadonlySet<SupplyErrorCode>;
 *   export const isSupplyError = isCodeMember<SupplyErrorCode>(SUPPLY_CODES);
 */
export function isCodeMember<C extends SodaxErrorCode>(codes: ReadonlySet<C>) {
  return (e: unknown): e is SodaxError<C> => isSodaxError(e) && (codes as ReadonlySet<string>).has(e.code);
}

export { isSodaxError } from './SodaxError.js';
