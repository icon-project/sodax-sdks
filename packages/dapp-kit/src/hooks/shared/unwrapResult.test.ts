import { SodaxError } from '@sodax/sdk';
import { describe, expect, it } from 'vitest';
import { unwrapResult } from './unwrapResult.js';

describe('unwrapResult', () => {
  it('returns the value on ok', () => {
    expect(unwrapResult({ ok: true, value: 42 })).toBe(42);
  });

  it('rethrows an Error identity-unchanged', () => {
    const error = new SodaxError('EXTERNAL_API_ERROR', 'solver said no', { feature: 'swap' });
    expect(() => unwrapResult({ ok: false, error })).toThrow(error);
  });

  it('prefers the solver message over its numeric code', () => {
    // detail.code is a number for solver errors. Reading it first produced `Error('-4')`, hiding the
    // only human-readable part of the failure behind `cause`.
    const error = { detail: { code: -4, message: 'No path was found between the two tokens' } };
    expect(() => unwrapResult({ ok: false, error })).toThrow('No path was found between the two tokens');
  });

  it('preserves the original failure on cause', () => {
    const error = { detail: { code: -23, message: 'input amount too low' } };
    try {
      unwrapResult({ ok: false, error });
      expect.unreachable('should have thrown');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).cause).toBe(error);
    }
  });

  it('falls back to the numeric code when there is no message', () => {
    expect(() => unwrapResult({ ok: false, error: { detail: { code: -999 } } })).toThrow('-999');
  });

  it('falls back to a top-level message, then to a generic string', () => {
    expect(() => unwrapResult({ ok: false, error: { message: 'plain object failure' } })).toThrow(
      'plain object failure',
    );
    expect(() => unwrapResult({ ok: false, error: {} })).toThrow('SDK call failed');
  });
});
