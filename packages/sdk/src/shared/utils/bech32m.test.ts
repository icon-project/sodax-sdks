/**
 * Tests for `decodeBech32m` — the bech32m address codec.
 *
 * `decodeBech32m` is the decoder behind `aleoAddressToHex` in AleoSpokeService: it turns an
 * `aleo1…` address into the raw 32-byte payload that feeds straight into deposit/sendMessage
 * transition inputs. A malformed address that slipped past the checksum would silently corrupt
 * transaction data, so every rejection path is pinned here.
 *
 * Happy-path vectors are the canonical bech32m strings from BIP-350 — they exercise the exact
 * polymod/charset/word-unpacking algorithm Aleo addresses rely on.
 */
import { describe, expect, it } from 'vitest';
import { decodeBech32m } from './bech32m.js';

// --- BIP-350 canonical bech32m vectors ------------------------------------
const EMPTY_DATA = 'A1LQFN3A'; // hrp 'a', zero data bytes
const EMPTY_DATA_LOWER = 'a1lqfn3a'; // same vector, already lowercase
const WITH_DATA = 'abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx'; // hrp 'abcdef', 20 data bytes
const LONG_HRP = 'split1checkupstagehandshakeupstreamerranterredcaperredlc445v'; // hrp 'split'

describe('decodeBech32m — valid input', () => {
  it('decodes a vector with an empty data section', () => {
    const { hrp, data } = decodeBech32m(EMPTY_DATA);
    expect(hrp).toBe('a');
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(0);
  });

  it('lowercases the human-readable part', () => {
    // EMPTY_DATA has an uppercase hrp ('A'); the decoder must normalize it.
    expect(decodeBech32m(EMPTY_DATA).hrp).toBe('a');
  });

  it('decodes uppercase and lowercase forms of the same vector identically', () => {
    const upper = decodeBech32m(EMPTY_DATA);
    const lower = decodeBech32m(EMPTY_DATA_LOWER);
    expect(lower.hrp).toBe(upper.hrp);
    expect(Array.from(lower.data)).toEqual(Array.from(upper.data));
  });

  it('unpacks the 5-bit words into bytes, dropping the 6-word checksum', () => {
    // WITH_DATA carries 32 data words after the hrp; 32 words → 160 bits → exactly 20 bytes.
    const { hrp, data } = decodeBech32m(WITH_DATA);
    expect(hrp).toBe('abcdef');
    expect(data.length).toBe(20);
  });

  it('handles a multi-character human-readable part', () => {
    expect(decodeBech32m(LONG_HRP).hrp).toBe('split');
  });
});

describe('decodeBech32m — malformed input', () => {
  it('throws when there is no "1" separator', () => {
    expect(() => decodeBech32m('abcdef')).toThrow('Invalid bech32m string');
  });

  it('throws when the separator is at position 0 (empty hrp)', () => {
    expect(() => decodeBech32m('1abcdefg')).toThrow('Invalid bech32m string');
  });

  it('throws when the data section is shorter than the 6-char checksum', () => {
    // pos = 3, pos + 7 = 10 > length 7 → too few data characters to hold a checksum.
    expect(() => decodeBech32m('abc1def')).toThrow('Invalid bech32m string');
  });

  it('throws on a character outside the bech32 charset', () => {
    // 'b' is one of the bech32-excluded characters (b, i, o, 1).
    expect(() => decodeBech32m('A1LbFN3A')).toThrow('Invalid bech32m character: b');
  });

  it('throws on a checksum mismatch (valid charset, wrong checksum)', () => {
    // EMPTY_DATA with its final char swapped — every char is still in-charset, only the
    // checksum is now wrong.
    expect(() => decodeBech32m('A1LQFN3Z')).toThrow('Invalid bech32m checksum');
  });

  it('rejects a plain bech32 (non-bech32m) string — wrong checksum constant', () => {
    // 'A12UEL5L' is a valid BIP-173 bech32 string; it must fail the bech32m checksum.
    expect(() => decodeBech32m('A12UEL5L')).toThrow('Invalid bech32m checksum');
  });
});
