import { describe, expect, it } from 'vitest';
import { decodeAccountId, xrpCurrencyCode, encodeAccountId, xrpIdentityBytes } from './xrp-utils.js';

/**
 * Fixtures are live mainnet values from the deployed relay (NEAR chain config for chain 66 and
 * the registered RLUSD IOU), not hand-computed — so a regression here means the SDK has diverged
 * from what the contract actually accepts.
 */
const RESERVE = 'rbtWzBnJB84fKuVCg2qbKKX4EUtCWVik7';
const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const RLUSD_ISSUER_ACCOUNT_ID = '0xe5e961c6a025c9404aa7b662dd1df975be75d13e';

describe('xrp-utils', () => {
  it('decodes a classic address to a 20-byte AccountID', () => {
    expect(decodeAccountId(RESERVE)).toHaveLength(20);
  });

  it('round-trips address → AccountID → address', () => {
    expect(encodeAccountId(decodeAccountId(RESERVE))).toBe(RESERVE);
    expect(encodeAccountId(decodeAccountId(RLUSD_ISSUER))).toBe(RLUSD_ISSUER);
  });

  it('derives the identity the relay registered for the RLUSD issuer', () => {
    expect(xrpIdentityBytes(RLUSD_ISSUER)).toBe(RLUSD_ISSUER_ACCOUNT_ID);
  });

  it('derives the 160-bit currency codes the relay registered', () => {
    // Both taken from the live NEAR asset registrations for chain 66.
    expect(xrpCurrencyCode('USDC')).toBe('5553444300000000000000000000000000000000');
    expect(xrpCurrencyCode('RLUSD')).toBe('524C555344000000000000000000000000000000');
  });

  it('leaves a 3-character code in ASCII form', () => {
    expect(xrpCurrencyCode('XRP')).toBe('XRP');
    expect(xrpCurrencyCode('EUR')).toBe('EUR');
  });

  it('agrees with an xrpl-generated ed25519 wallet', () => {
    // Fixture produced by `Wallet.fromEntropy(<32 zero bytes>, { algorithm: 'ed25519' })` — the
    // exact derivation XrpWalletProvider uses, so a divergence here is an identity mismatch that
    // the contract would reject on-chain.
    const address = 'r9zRhGr7b6xPekLvT6wP4qNdWMryaumZS7';
    expect(xrpIdentityBytes(address)).toBe('0x629ccc144ac8464561f11d8870a57dc376a0d191');
  });

  it('rejects a bad checksum', () => {
    const bad = `${RESERVE.slice(0, -1)}${RESERVE.endsWith('7') ? '8' : '7'}`;
    expect(() => decodeAccountId(bad)).toThrow(/checksum/);
  });
});
