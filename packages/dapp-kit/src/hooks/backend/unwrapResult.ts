import type { Result } from '@sodax/sdk';

export function unwrapResult<T>(result: Result<T>): T {
  if (!result.ok) {
    throw result.error instanceof Error ? result.error : new Error('Backend call failed');
  }
  return result.value;
}
