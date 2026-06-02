import { describe, expect, it } from 'vitest';
import { normalizeSignatureToBase64 } from './btc-utils.js';

describe('normalizeSignatureToBase64', () => {
  // Browser wallets (UniSat/Xverse/OKX) already return base64 — the relay's required form — so a
  // base64 signature must pass through untouched. Real base64 carries chars outside the hex set
  // ('=' padding, '+'/'/', upper-case G–Z), which is exactly what marks it as "not hex".
  it('passes a base64 signature through unchanged', () => {
    expect(normalizeSignatureToBase64('EjQ=')).toBe('EjQ=');
    expect(normalizeSignatureToBase64('aGVsbG8=')).toBe('aGVsbG8='); // base64("hello"), has non-hex chars
  });

  // A private-key wallet may hand back a hex signature; it is encoded to base64 before relay submit.
  it('encodes a hex signature to base64', () => {
    expect(normalizeSignatureToBase64('deadbeef')).toBe('3q2+7w==');
  });
});
