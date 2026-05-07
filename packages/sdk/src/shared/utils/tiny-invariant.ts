const prefix: string = 'Invariant failed';

/**
 * `invariant` is used to [assert](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-7.html#assertion-functions) that the `condition` is [truthy](https://github.com/getify/You-Dont-Know-JS/blob/bdbe570600d4e1107d0b131787903ca1c9ec8140/up%20%26%20going/ch2.md#truthy--falsy).
 *
 * 💥 `invariant` will `throw` an `Error` if the `condition` is [falsey](https://github.com/getify/You-Dont-Know-JS/blob/bdbe570600d4e1107d0b131787903ca1c9ec8140/up%20%26%20going/ch2.md#truthy--falsy)
 *
 * @example
 *
 * ```ts
 * const value: Person | null = { name: 'Alex' };
 * invariant(value, 'Expected value to be a person');
 * // type of `value`` has been narrowed to `Person`
 * ```
 */
export function invariant(
  // biome-ignore lint/suspicious/noExplicitAny: any required for type inference
  condition: any,
  // Not providing an inline default argument for message as the result is smaller
  /**
   * Can provide a string, or a function that returns a string for cases where
   * the message takes a fair amount of effort to compute
   */
  message?: string | (() => string),
): asserts condition {
  if (condition) {
    return;
  }
  // Condition not passed

  const provided: string | undefined = typeof message === 'function' ? message() : message;

  // Options:
  // 1. message provided: `${prefix}: ${provided}`
  // 2. message not provided: prefix
  const value: string = provided ? `${prefix}: ${provided}` : prefix;
  throw new Error(value);
}

/**
 * Assert variant that throws a caller-supplied error (lazily constructed) instead of the
 * generic prefixed `Error` that {@link invariant} produces. Use this when the throw site
 * has structured information (e.g. a `SodaxError` code + context) that callers downstream
 * need to discriminate on, so the catch block can short-circuit on the typed shape rather
 * than parse a string prefix back out of `error.message`.
 *
 * The factory is lazy so error construction (and the stack capture cost it implies) only
 * fires when the assertion fails — no overhead on the happy path.
 *
 * @example
 *   assertOk(supported, () => new SodaxError('SWAP_VALIDATION_FAILED', 'Unsupported token'));
 */
export function assertOk<E extends Error>(
  // biome-ignore lint/suspicious/noExplicitAny: any required for type inference
  condition: any,
  makeError: () => E,
): asserts condition {
  if (condition) return;
  throw makeError();
}
