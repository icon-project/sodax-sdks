/**
 * Single shared precondition assertion for all SDK features. Throws
 * `SodaxError<'VALIDATION_FAILED'>` with `feature` set and `context.phase = 'validate'`
 * when `cond` is falsy.
 *
 * Per-feature 1-line aliases via {@link createInvariant} preserve call-site ergonomics:
 *
 * ```ts
 * export const swapInvariant = createInvariant('swap');
 * swapInvariant(amount > 0n, 'Amount must be greater than 0', { field: 'amount' });
 * ```
 */

import { assertOk } from '../shared/utils/tiny-invariant.js';
import type { SodaxErrorContext, SodaxFeature } from './codes.js';
import { SodaxError } from './SodaxError.js';

export function sodaxInvariant(
  cond: unknown,
  message: string,
  opts: { feature: SodaxFeature; context?: Partial<SodaxErrorContext> },
): asserts cond {
  assertOk(
    cond,
    () =>
      new SodaxError('VALIDATION_FAILED', message, {
        feature: opts.feature,
        context: { phase: 'validate', ...opts.context },
      }),
  );
}

/**
 * Signature of the feature-bound invariant returned by {@link createInvariant}. Declared as
 * a named type so the `asserts cond` predicate survives the factory boundary — TypeScript
 * does not propagate `asserts` from arrow function bodies through inferred return types.
 */
export type FeatureInvariant = (
  cond: unknown,
  message: string,
  context?: Partial<SodaxErrorContext>,
) => asserts cond;

/**
 * Returns a feature-bound invariant helper. The call-site shape mirrors the legacy
 * per-feature `*Invariant` helpers exactly:
 *
 * ```ts
 * const swapInvariant = createInvariant('swap');
 * swapInvariant(cond, 'msg', { field: 'amount' });
 * ```
 */
export function createInvariant(feature: SodaxFeature): FeatureInvariant {
  return (cond, message, context) => {
    sodaxInvariant(cond, message, { feature, context });
  };
}
