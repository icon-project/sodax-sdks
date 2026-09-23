import type { Result } from '@sodax/sdk';

/**
 * Translates the SDK's `Result<T>` contract into the React Query contract: returns `value` on
 * success, throws `error` on failure. Non-`Error` throwables are wrapped so consumers always get
 * an `Error` in `mutation.error` / catch blocks.
 *
 * Used by every dapp-kit mutation hook so the React Query error model (`isError`, `error`,
 * `onError`, `retry`, `throwOnError`, devtools) engages uniformly.
 */
export function unwrapResult<T>(result: Result<T>): T {
  if (!result.ok) {
    if (result.error instanceof Error) throw result.error;
    // Prefer the prose: a solver failure's `detail.code` is a NUMBER, so reading it first turned the
    // whole error into `Error('-4')` and left the readable text reachable only via `cause`.
    const e = result.error as { message?: string; detail?: { code?: number | string; message?: string } };
    // `??` keeps an empty string, which would surface as `Error('')` — treat blank prose as absent.
    const text = (value?: string): string | undefined => (value?.trim() ? value : undefined);
    const msg = text(e?.detail?.message) ?? text(e?.message) ?? e?.detail?.code?.toString() ?? 'SDK call failed';
    throw new Error(msg, { cause: result.error });
  }
  return result.value;
}
