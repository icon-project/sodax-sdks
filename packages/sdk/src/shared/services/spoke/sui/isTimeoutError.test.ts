import { describe, expect, it } from 'vitest';

import { isTimeoutError } from './isTimeoutError.js';

describe('isTimeoutError', () => {
  it('matches the Node AbortSignal.timeout reason', () => {
    expect(isTimeoutError(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe(true);
  });

  it('matches the browser AbortSignal.timeout reason, whose message says nothing about "timeout"', () => {
    expect(isTimeoutError({ name: 'TimeoutError', message: 'signal timed out' })).toBe(true);
  });

  it('matches an explicit abort', () => {
    expect(isTimeoutError(new DOMException('This operation was aborted', 'AbortError'))).toBe(true);
  });

  it('falls back to the message for errors rethrown without a name', () => {
    expect(isTimeoutError(new Error('waitForTransaction timeout exceeded'))).toBe(true);
  });

  it('does not match unrelated failures', () => {
    expect(isTimeoutError(new Error('connection refused'))).toBe(false);
    expect(isTimeoutError('boom')).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
  });
});
