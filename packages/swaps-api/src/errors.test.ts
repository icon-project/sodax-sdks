import { describe, expect, it } from 'vitest';
import { SwapsApiError } from './errors.js';

describe('SwapsApiError', () => {
  it('carries code, message, and context', () => {
    const err = new SwapsApiError('HTTP_ERROR', 'boom', { status: 500, endpoint: 'getQuote' });
    expect(err).toBeInstanceOf(SwapsApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('HTTP_ERROR');
    expect(err.message).toBe('boom');
    expect(err.context.status).toBe(500);
    expect(err.context.endpoint).toBe('getQuote');
    expect(err.name).toBe('SwapsApiError');
  });

  it('preserves the original cause', () => {
    const cause = new Error('root');
    const err = new SwapsApiError('NETWORK_ERROR', 'wrap', {}, { cause });
    expect(err.cause).toBe(cause);
  });

  it('defaults context to an empty object', () => {
    const err = new SwapsApiError('PARSE_ERROR', 'bad json');
    expect(err.context).toEqual({});
  });
});
