import { describe, expect, it } from 'vitest';
import { isFillEvent } from './guards.js';

const FILL_EVENT = {
  eventType: 'intent-filled',
  txHash: '0xfe2839879f18d3ededb1e5f9a60f267c1a6ed81a388ab47d4f97179e529c489b',
};

describe('isFillEvent', () => {
  it('accepts an intent-filled event', () => {
    expect(isFillEvent(FILL_EVENT)).toBe(true);
  });

  it('accepts an event carrying fields the SDK does not model', () => {
    expect(isFillEvent({ ...FILL_EVENT, logIndex: 48, intentState: { remainingInput: '0' } })).toBe(true);
  });

  it.each([
    null,
    'intent-filled',
    { ...FILL_EVENT, eventType: 'intent-cancelled' },
    { ...FILL_EVENT, txHash: '' },
  ])('rejects %#', value => {
    expect(isFillEvent(value)).toBe(false);
  });
});
