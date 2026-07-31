import { toHex, type Hex } from 'viem';
import { decodeBech32m } from './bech32m.js';

const ALEO_ADDRESS_PREFIX = 'aleo1';
const ALEO_ADDRESS_LENGTH = 63;

export function isValidAleoAddress(address: string): boolean {
  return typeof address === 'string' && address.startsWith(ALEO_ADDRESS_PREFIX) && address.length === ALEO_ADDRESS_LENGTH;
}

/**
 * Decode an `aleo1…` address to the reversed-byte hex form the Aleo programs expect.
 *
 * The prefix/length guard must run before the bech32m decode: tx ids (`at1…`), private keys,
 * and records are also checksum-valid bech32m, so an unguarded decode would silently encode
 * them instead of failing fast. This is the single validated decode path — use it everywhere
 * an Aleo address is converted to hex.
 */
export function aleoAddressToHex(address: string): Hex {
  if (!isValidAleoAddress(address)) {
    throw new Error(`Invalid Aleo address: ${address}`);
  }
  const { data } = decodeBech32m(address);
  return toHex(new Uint8Array([...data].reverse()));
}
