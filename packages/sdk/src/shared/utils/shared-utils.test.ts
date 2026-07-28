/**
 * ICON address validation in `encodeAddress` (SWAP-M-1).
 *
 * The ICON branch previously hex-decoded without validating type or length: `Buffer.from(str, 'hex')`
 * silently truncates at the first non-hex char, and the old unanchored `.replace()` rewrote any
 * `hx`/`cx` occurring inside the body, so a malformed destination could slip into an intent. These
 * tests lock in that valid `hx`/`cx` addresses round-trip through `encodeAddress`/`reverseEncodeAddress`
 * and that malformed inputs are rejected before encoding.
 */
import { describe, expect, it } from 'vitest';
import { ChainKeys } from '@sodax/types';
import { encodeAddress, reverseEncodeAddress } from './shared-utils.js';

const ICON_MAINNET = ChainKeys.ICON_MAINNET;

const HX = 'hx0000000000000000000000000000000000000001';
const CX = 'cx1111111111111111111111111111111111111111';

describe('encodeAddress (ICON)', () => {
  it('encodes a valid hx address with the 00 version byte and round-trips', () => {
    const encoded = encodeAddress(ICON_MAINNET, HX);
    expect(encoded).toBe(`0x00${HX.slice(2)}`);
    expect(reverseEncodeAddress(ICON_MAINNET, encoded)).toBe(HX);
  });

  it('encodes a valid cx address with the 01 version byte and round-trips', () => {
    const encoded = encodeAddress(ICON_MAINNET, CX);
    expect(encoded).toBe(`0x01${CX.slice(2)}`);
    expect(reverseEncodeAddress(ICON_MAINNET, encoded)).toBe(CX);
  });

  it.each([
    ['bare prefix', 'hx'],
    ['non-hex body', 'hxZZZ0000000000000000000000000000000000000'],
    ['truncated body', 'hx000000000000000000000000000000000000001'],
    ['over-length body', 'hx00000000000000000000000000000000000000011'],
    ['missing prefix', '0000000000000000000000000000000000000001'],
    ['wrong prefix', 'ax0000000000000000000000000000000000000001'],
    ['empty string', ''],
  ])('rejects a malformed ICON address (%s)', (_label, address) => {
    expect(() => encodeAddress(ICON_MAINNET, address)).toThrow(/Invalid ICON address/);
  });
});
