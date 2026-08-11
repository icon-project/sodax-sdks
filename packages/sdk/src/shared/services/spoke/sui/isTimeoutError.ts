/**
 * `waitForTransaction` rejects with `AbortSignal.timeout`'s `DOMException`, whose message differs
 * per runtime ("aborted due to timeout" on Node, "signal timed out" in browsers) — match the name.
 */
export function isTimeoutError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const { name } = error as { name: unknown };
    if (name === 'TimeoutError' || name === 'AbortError') {
      return true;
    }
  }
  return error instanceof Error && /timed?\s?out|timeout/i.test(error.message);
}
