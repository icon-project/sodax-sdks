/**
 * Tests for the wallet-rejection classifying wrappers.
 *
 * The detector itself (`isWalletRejection`) is private to `wrappers.ts`, so we exercise it
 * indirectly through `intentCreationFailed` (the wrapper most service catch blocks use): if the
 * cause is a recognised rejection shape, the returned error has `code === 'USER_REJECTED'`;
 * otherwise it falls back to the wrapper's own code (`INTENT_CREATION_FAILED`).
 *
 * Coverage matrix:
 * - viem:    UserRejectedRequestError (name), EIP-1193 code 4001, ethers ACTION_REJECTED
 * - ICON:    CANCEL_SIGNING / CANCEL_JSON-RPC string codes, numeric -31002
 * - generic: text patterns ('user rejected', 'user denied', 'transaction rejected', 'user abort',
 *            'popup closed', 'rejected by user', 'request rejected', case-insensitive)
 * - misses:  non-rejection errors (network, validation) must NOT classify as USER_REJECTED
 */

import { UserRejectedRequestError } from 'viem';
import { describe, expect, it } from 'vitest';
import { approveFailed, intentCreationFailed } from './wrappers.js';

describe('intentCreationFailed (wallet rejection classification)', () => {
  it('classifies a viem UserRejectedRequestError instance as USER_REJECTED', () => {
    const wallet = new UserRejectedRequestError(new Error('User denied transaction signature.'));
    const err = intentCreationFailed('staking', wallet);
    expect(err.code).toBe('USER_REJECTED');
    expect(err.feature).toBe('staking');
    expect(err.cause).toBe(wallet);
  });

  it('classifies any object with name === "UserRejectedRequestError" as USER_REJECTED', () => {
    const err = intentCreationFailed('swap', { name: 'UserRejectedRequestError', message: 'anything' });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies EIP-1193 code 4001 as USER_REJECTED', () => {
    const err = intentCreationFailed('moneyMarket', { code: 4001, message: 'reject' });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies ethers ACTION_REJECTED as USER_REJECTED', () => {
    const err = intentCreationFailed('bridge', { code: 'ACTION_REJECTED' });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies ICON Hana CANCEL_SIGNING as USER_REJECTED', () => {
    const err = intentCreationFailed('migration', { code: 'CANCEL_SIGNING' });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies ICON Hana CANCEL_JSON-RPC as USER_REJECTED', () => {
    const err = intentCreationFailed('migration', { code: 'CANCEL_JSON-RPC' });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies ICON numeric code -31002 as USER_REJECTED', () => {
    const err = intentCreationFailed('migration', { code: -31002 });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies Solana WalletSignTransactionError + "User rejected" message as USER_REJECTED', () => {
    const err = intentCreationFailed('swap', {
      name: 'WalletSignTransactionError',
      message: 'User rejected the request',
    });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies Phantom-style "Transaction was rejected" message as USER_REJECTED', () => {
    const err = intentCreationFailed('swap', new Error('Transaction was rejected by the user.'));
    expect(err.code).toBe('USER_REJECTED');
  });

  it('does NOT classify "Transaction rejected by node" (network failure, no `was`) as USER_REJECTED', () => {
    // The `was` in `/transaction was rejected/i` is mandatory so chain-level / RPC-level
    // rejections that don't include "was" stay as INTENT_CREATION_FAILED (not a user cancel).
    const err = intentCreationFailed('swap', new Error('Transaction rejected by node'));
    expect(err.code).toBe('INTENT_CREATION_FAILED');
  });

  it('classifies "User aborted" message (some mobile wallets) as USER_REJECTED', () => {
    const err = intentCreationFailed('swap', new Error('User aborted signing.'));
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies "popup closed by user" message (Stacks Connect) as USER_REJECTED', () => {
    const err = intentCreationFailed('migration', new Error('Popup closed by user'));
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies shortMessage field (viem layout) as USER_REJECTED', () => {
    const err = intentCreationFailed('staking', { shortMessage: 'User rejected the request.' });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('classifies details field (viem layout) as USER_REJECTED', () => {
    const err = intentCreationFailed('staking', {
      details: 'MetaMask Tx Signature: User denied transaction signature.',
    });
    expect(err.code).toBe('USER_REJECTED');
  });

  it('does NOT classify a network error as USER_REJECTED', () => {
    const err = intentCreationFailed('swap', new Error('Network request failed'));
    expect(err.code).toBe('INTENT_CREATION_FAILED');
  });

  it('does NOT classify "insufficient funds" as USER_REJECTED', () => {
    const err = intentCreationFailed('moneyMarket', new Error('insufficient funds for gas'));
    expect(err.code).toBe('INTENT_CREATION_FAILED');
  });

  it('does NOT classify EVM revert (code -32000) as USER_REJECTED', () => {
    const err = intentCreationFailed('bridge', { code: -32000, message: 'execution reverted' });
    expect(err.code).toBe('INTENT_CREATION_FAILED');
  });

  it('does NOT classify undefined/null cause as USER_REJECTED', () => {
    expect(intentCreationFailed('swap', undefined).code).toBe('INTENT_CREATION_FAILED');
    expect(intentCreationFailed('swap', null).code).toBe('INTENT_CREATION_FAILED');
  });
});

describe('approveFailed (wallet rejection classification)', () => {
  it('classifies viem rejection as USER_REJECTED, otherwise APPROVE_FAILED', () => {
    expect(approveFailed('staking', { code: 4001 }).code).toBe('USER_REJECTED');
    expect(approveFailed('staking', new Error('execution reverted')).code).toBe('APPROVE_FAILED');
  });
});

describe('USER_REJECTED clean message', () => {
  it('uses a hardcoded "User rejected the request" message, not the cause.message', () => {
    // viem's UserRejectedRequestError message is a multi-line dump with Request Arguments + Version.
    // The wrapper must NOT inherit that as the SodaxError.message — Sentry/Datadog titles must stay clean.
    const noisyCause = new UserRejectedRequestError(
      new Error(
        'User rejected the request.\n\nRequest Arguments:\n  from: 0xabc\n  to: 0xdef\n  data: 0x1234...\n\nDetails: User rejected the request.\nVersion: viem@2.29.2',
      ),
    );

    const err = intentCreationFailed('staking', noisyCause);

    expect(err.code).toBe('USER_REJECTED');
    expect(err.message).toBe('User rejected the request');
    expect(err.message).not.toContain('Request Arguments');
    expect(err.message).not.toContain('Version: viem');

    // The raw cause is still preserved for debugging.
    expect(err.cause).toBe(noisyCause);
  });
});
