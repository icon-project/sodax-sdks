/**
 * Normalize a caller-supplied `timeout` into a usable duration, defaulting when it is absent or not a
 * finite number.
 *
 * `?? fallbackMs` — and the equivalent `timeout = fallbackMs` destructuring default — only catch
 * `undefined`. A `NaN` from something like `Number(process.env.TIMEOUT)` sails through both, then
 * through every `Math.max`/`Math.min` untouched (`Math.max(0, NaN)` is `NaN`), and lands in
 * `while (elapsed < NaN)`, which is false on its very first check: a relay wait that gives up
 * instantly on a transaction already broadcast on-chain. `Infinity` is the mirror case — a poll loop
 * with no exit.
 *
 * Deliberately a zero-dependency leaf, and deliberately NOT re-exported from `shared/utils/index.ts`
 * (like `tiny-invariant.ts`): it is an internal guard, not SDK surface. Import it by path.
 */
export function resolveTimeoutMs(timeout: number | undefined, fallbackMs: number): number {
  if (timeout === undefined || !Number.isFinite(timeout)) return fallbackMs;
  return Math.max(0, timeout);
}
