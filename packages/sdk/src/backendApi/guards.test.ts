import { describe, expect, it } from 'vitest';
import { isFillEvent } from './guards.js';

const FILL_EVENT = {
  eventType: 'intent-filled',
  txHash: '0xfe2839879f18d3ededb1e5f9a60f267c1a6ed81a388ab47d4f97179e529c489b',
  intentState: { remainingInput: '0' },
};

describe('isFillEvent', () => {
  it('accepts an intent-filled event', () => {
    expect(isFillEvent(FILL_EVENT)).toBe(true);
  });

  it('accepts an event carrying fields the SDK does not model', () => {
    expect(
      isFillEvent({
        ...FILL_EVENT,
        logIndex: 48,
        blockNumber: 77220456,
        intentState: { exists: true, remainingInput: '0', receivedOutput: '682690297556913248', pendingPayment: false },
      }),
    ).toBe(true);
  });

  // A partial fill is still a well-formed fill event — the guard narrows the shape, and the caller
  // decides terminality from `remainingInput`.
  it('accepts a partial fill and exposes its remainder', () => {
    const partial = { ...FILL_EVENT, intentState: { remainingInput: '1000' } };
    expect(isFillEvent(partial)).toBe(true);
    if (isFillEvent(partial)) expect(partial.intentState.remainingInput).toBe('1000');
  });

  it.each([
    null,
    'intent-filled',
    { ...FILL_EVENT, eventType: 'intent-cancelled' },
    { ...FILL_EVENT, txHash: '' },
    // Without `intentState` there is no way to tell a partial fill from a complete one.
    { eventType: 'intent-filled', txHash: '0xfill' },
    { ...FILL_EVENT, intentState: {} },
    { ...FILL_EVENT, intentState: { remainingInput: 0 } },
  ])('rejects %#', value => {
    expect(isFillEvent(value)).toBe(false);
  });
});
