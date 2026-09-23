import { SwapsApiError } from '@sodax/swaps-api';
import { describe, expect, it } from 'vitest';
import { SodaxError } from '../errors/SodaxError.js';
import { isAmountTooSmallRefusal } from './quoteRefusal.js';

const solverRefusal = { detail: { code: -1, message: 'Input amount too low' } };

/** What `sodax.api.swaps.getQuote` returns for the same refusal: the backend's 422, wrapped twice. */
function backendRefusal(message = 'Failed to get quote: Input amount too low'): {
  wire: SwapsApiError;
  wrapped: SodaxError<'EXTERNAL_API_ERROR'>;
} {
  const wire = new SwapsApiError('HTTP_ERROR', 'getQuote responded with 422', {
    endpoint: 'getQuote',
    status: 422,
    body: { message, code: -1 },
  });
  const wrapped = new SodaxError('EXTERNAL_API_ERROR', wire.message, {
    feature: 'backend',
    cause: wire,
    context: { api: 'swaps', endpoint: '/swaps/quote', code: wire.code, status: 422 },
  });
  return { wire, wrapped };
}

function nestErrors(innermost: Error, layers: number): Error {
  let error = innermost;
  for (let i = 0; i < layers; i++) {
    error = new Error(`layer ${i}`, { cause: error });
  }
  return error;
}

describe('isAmountTooSmallRefusal', () => {
  it('reads the raw solver response from sodax.swaps.getQuote', () => {
    expect(isAmountTooSmallRefusal(solverRefusal)).toBe(true);
  });

  it('reads the backend 422 through the SodaxError → SwapsApiError → body chain', () => {
    const { wire, wrapped } = backendRefusal();
    expect(isAmountTooSmallRefusal(wrapped)).toBe(true);
    expect(isAmountTooSmallRefusal(wire)).toBe(true);
  });

  it('reads a solverDetail lifted onto a SodaxError context', () => {
    const error = new SodaxError('EXTERNAL_API_ERROR', 'Input amount too low', {
      feature: 'swap',
      context: { api: 'solver', solverCode: -1, solverDetail: solverRefusal.detail },
    });
    expect(isAmountTooSmallRefusal(error)).toBe(true);
  });

  it('accepts the proposed "Quote too small" wording, in any case', () => {
    expect(isAmountTooSmallRefusal({ detail: { code: -1, message: 'Quote too small' } })).toBe(true);
    expect(isAmountTooSmallRefusal(backendRefusal('Failed to get quote: quote TOO small').wrapped)).toBe(true);
  });

  it('is false for the routing refusal that shares code -1', () => {
    expect(isAmountTooSmallRefusal({ detail: { code: -1, message: 'No path was found' } })).toBe(false);
    expect(isAmountTooSmallRefusal(backendRefusal('Failed to get quote: No path was found').wrapped)).toBe(false);
  });

  it('is false for other failures and non-errors', () => {
    expect(isAmountTooSmallRefusal({ detail: { code: -999, message: 'Unknown error' } })).toBe(false);
    expect(isAmountTooSmallRefusal(new Error('fetch failed'))).toBe(false);
    expect(isAmountTooSmallRefusal(new SwapsApiError('TIMEOUT_ERROR', 'getQuote timed out'))).toBe(false);
    expect(isAmountTooSmallRefusal(undefined)).toBe(false);
    expect(isAmountTooSmallRefusal(null)).toBe(false);
    expect(isAmountTooSmallRefusal(42)).toBe(false);
    expect(isAmountTooSmallRefusal('')).toBe(false);
    expect(isAmountTooSmallRefusal({ detail: { code: -1 } })).toBe(false);
  });

  it('follows a cause chain up to four hops and no further', () => {
    const innermost = new Error('Input amount too low');
    expect(isAmountTooSmallRefusal(nestErrors(innermost, 4))).toBe(true);
    expect(isAmountTooSmallRefusal(nestErrors(innermost, 5))).toBe(false);
  });
});
