/**
 * Tests for the validated Aleo address → hex path (`aleo-utils.ts`).
 *
 * `aleoAddressToHex` feeds `encodeAddress` on the live intent-creation path (swap / bridge /
 * staking), so a non-address bech32m string must fail fast instead of encoding silently.
 * `decodeBech32m` only validates the checksum — tx ids (`at1…`), private keys, and records are
 * also checksum-valid bech32m, so the prefix/length guard is what rejects them. Every vector
 * here is checksum-valid unless the test says otherwise.
 */
import { describe, expect, it } from 'vitest';
import { ChainKeys } from '@sodax/types';
import { aleoAddressToHex, isValidAleoAddress } from './aleo-utils.js';
import { encodeAddress } from './shared-utils.js';

// hrp 'aleo', payload bytes 0x01..0x20 — generated with the reference bech32m encoder.
const VALID_ADDRESS = 'aleo1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5z5tpwxqergd3c8g7rusq7fa04s';
const VALID_ADDRESS_HEX = '0x201f1e1d1c1b1a191817161514131211100f0e0d0c0b0a090807060504030201';
// Same payload, hrp 'at' — 61 chars, shaped exactly like an Aleo transaction id.
const TX_ID_SHAPED = 'at1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5z5tpwxqergd3c8g7rusqhemxyq';
// BIP-350 canonical vector — checksum-valid bech32m with an unrelated hrp.
const WRONG_HRP = 'abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx';

describe('isValidAleoAddress', () => {
  it('accepts a 63-char aleo1… address', () => {
    expect(isValidAleoAddress(VALID_ADDRESS)).toBe(true);
  });

  it('rejects a tx-id-shaped at1… string', () => {
    expect(isValidAleoAddress(TX_ID_SHAPED)).toBe(false);
  });

  it('rejects an aleo1… string of the wrong length', () => {
    expect(isValidAleoAddress(VALID_ADDRESS.slice(0, -1))).toBe(false);
    expect(isValidAleoAddress(`${VALID_ADDRESS}s`)).toBe(false);
  });
});

describe('aleoAddressToHex', () => {
  it('decodes a valid address to reversed-byte hex', () => {
    expect(aleoAddressToHex(VALID_ADDRESS)).toBe(VALID_ADDRESS_HEX);
  });

  it('throws on a checksum-valid tx-id-shaped string (guard, not checksum, rejects it)', () => {
    expect(() => aleoAddressToHex(TX_ID_SHAPED)).toThrow('Invalid Aleo address');
  });

  it('throws on a checksum-valid bech32m string with an unrelated hrp', () => {
    expect(() => aleoAddressToHex(WRONG_HRP)).toThrow('Invalid Aleo address');
  });

  it('still fails the bech32m checksum when the guard passes but the payload is corrupt', () => {
    // aleo1 prefix + 63 chars satisfies the guard; the codec must reject the checksum.
    expect(() => aleoAddressToHex(`aleo1${'q'.repeat(58)}`)).toThrow('Invalid bech32m checksum');
  });
});

describe('encodeAddress — ALEO branch', () => {
  it('routes through the validated decode path', () => {
    expect(encodeAddress(ChainKeys.ALEO_MAINNET, VALID_ADDRESS)).toBe(VALID_ADDRESS_HEX);
  });

  it('rejects a non-address bech32m string instead of encoding it silently', () => {
    expect(() => encodeAddress(ChainKeys.ALEO_MAINNET, TX_ID_SHAPED)).toThrow('Invalid Aleo address');
  });
});
