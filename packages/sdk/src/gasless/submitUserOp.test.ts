/**
 * Unit tests for `submitUserOp`. The viem `account-abstraction` layer is mocked, so the tests assert
 * the wiring: the op is broadcast with the externally-produced signature (and no `calls`, so viem
 * neither re-estimates nor re-signs), the signed 7702 authorization is forwarded, the receipt's tx
 * hash is returned, and a reverted user op throws. They also cover idempotency-on-`userOpHash`: a
 * re-broadcast of an already-known / already-included op recovers that op's receipt instead of
 * failing, while a rejection with no receipt for this exact hash stays a genuine failure.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Address, Hex, PublicClient, SignedAuthorization } from 'viem';
import { submitUserOp } from './internal/submitUserOp.js';
import type { UnsignedUserOp } from './internal/userOpDto.js';

const mocks = vi.hoisted(() => ({
  toSimple7702SmartAccount: vi.fn(),
  createBundlerClient: vi.fn(),
  sendUserOperation: vi.fn(),
  waitForUserOperationReceipt: vi.fn(),
  getUserOperationReceipt: vi.fn(),
}));

vi.mock('viem/account-abstraction', () => ({
  toSimple7702SmartAccount: mocks.toSimple7702SmartAccount,
  createBundlerClient: mocks.createBundlerClient,
}));

const SENDER = '0x1111111111111111111111111111111111111111' as Address;
const USER_OP_HASH = `0x${'ab'.repeat(32)}` as Hex;
const publicClient = {} as unknown as PublicClient;

const USER_OP: UnsignedUserOp = {
  sender: SENDER,
  nonce: 5n,
  callData: '0xcafe' as Hex,
  callGasLimit: 100000n,
  verificationGasLimit: 200000n,
  preVerificationGas: 50000n,
  maxFeePerGas: 1000n,
  maxPriorityFeePerGas: 900n,
  paymaster: '0x00000000000000000000000000000000000000aa' as Address,
  paymasterData: '0xbeef' as Hex,
};

const baseParams = {
  publicClient,
  sender: SENDER,
  userOp: USER_OP,
  userOpSignature: '0xsig' as Hex,
  userOpHash: USER_OP_HASH,
  bundlerUrl: 'https://bundler',
};

// Wire the fake bundler client + Simple7702 account. `receipt` is the default `waitForUserOperationReceipt`
// resolution for the happy path; the duplicate-recovery tests override the individual mocks they exercise.
const setup = (receipt: unknown) => {
  mocks.toSimple7702SmartAccount.mockResolvedValue({
    address: SENDER,
    entryPoint: { address: '0xEP', version: '0.8' },
  });
  mocks.createBundlerClient.mockReturnValue({
    sendUserOperation: mocks.sendUserOperation,
    waitForUserOperationReceipt: mocks.waitForUserOperationReceipt,
    getUserOperationReceipt: mocks.getUserOperationReceipt,
  });
  mocks.sendUserOperation.mockResolvedValue('0xuserophash');
  mocks.waitForUserOperationReceipt.mockResolvedValue(receipt);
};

afterEach(() => vi.clearAllMocks());

describe('submitUserOp', () => {
  it('broadcasts the exact op with the provided signature (no calls) and returns the tx hash', async () => {
    setup({ success: true, receipt: { transactionHash: '0xtxhash' } });

    const result = await submitUserOp(baseParams);

    expect(result).toEqual({ srcChainTxHash: '0xtxhash', alreadyKnown: false });
    const arg = mocks.sendUserOperation.mock.calls[0][0];
    expect(arg.signature).toBe('0xsig');
    expect(arg.sender).toBe(SENDER);
    expect(arg.nonce).toBe(5n);
    // no `calls` → viem does not re-prepare/re-estimate the op
    expect('calls' in arg).toBe(false);
  });

  it('forwards a signed 7702 authorization when provided', async () => {
    setup({ success: true, receipt: { transactionHash: '0xtxhash' } });
    const authorization = {
      chainId: 56,
      address: '0x000000000000000000000000000000000000e702' as Address,
      nonce: 7,
      r: '0x1' as Hex,
      s: '0x2' as Hex,
      yParity: 0,
    } satisfies SignedAuthorization;

    await submitUserOp({ ...baseParams, authorization });

    expect(mocks.sendUserOperation.mock.calls[0][0].authorization).toEqual(authorization);
  });

  it('throws when the user operation reverts on-chain', async () => {
    setup({ success: false, receipt: { transactionHash: '0xtxhash' } });

    await expect(submitUserOp(baseParams)).rejects.toThrow('reverted on-chain');
  });

  it('recovers an already-included op (nonce consumed) via a single receipt lookup and reports alreadyKnown', async () => {
    setup({ success: true, receipt: { transactionHash: '0xfresh' } });
    mocks.sendUserOperation.mockRejectedValue(new Error('AA25 invalid account nonce'));
    mocks.getUserOperationReceipt.mockResolvedValue({ success: true, receipt: { transactionHash: '0xincluded' } });

    const result = await submitUserOp(baseParams);

    expect(result).toEqual({ srcChainTxHash: '0xincluded', alreadyKnown: true });
    expect(mocks.getUserOperationReceipt).toHaveBeenCalledWith({ hash: USER_OP_HASH });
    // "consumed" must not wait: if a different op took the nonce, ours never mines.
    expect(mocks.waitForUserOperationReceipt).not.toHaveBeenCalled();
  });

  it('recovers an already-known (pending) op by waiting for its receipt and reports alreadyKnown', async () => {
    setup({ success: true, receipt: { transactionHash: '0xmined' } });
    mocks.sendUserOperation.mockRejectedValue(new Error('already known'));

    const result = await submitUserOp(baseParams);

    expect(result).toEqual({ srcChainTxHash: '0xmined', alreadyKnown: true });
    // "known" waits on THIS op's userOpHash and does not do the single-lookup path.
    expect(mocks.waitForUserOperationReceipt).toHaveBeenCalledWith({ hash: USER_OP_HASH });
    expect(mocks.getUserOperationReceipt).not.toHaveBeenCalled();
  });

  it('keeps a rejection a failure when no receipt exists for this op (nonce consumed by a different op)', async () => {
    setup({ success: true, receipt: { transactionHash: '0xfresh' } });
    mocks.sendUserOperation.mockRejectedValue(new Error('AA25 invalid account nonce'));
    mocks.getUserOperationReceipt.mockRejectedValue(new Error('User Operation receipt not found'));

    await expect(submitUserOp(baseParams)).rejects.toThrow('AA25 invalid account nonce');
  });

  it('treats a recovered-but-reverted op as a deterministic failure', async () => {
    setup({ success: true, receipt: { transactionHash: '0xfresh' } });
    mocks.sendUserOperation.mockRejectedValue(new Error('already included'));
    mocks.getUserOperationReceipt.mockResolvedValue({ success: false, receipt: { transactionHash: '0xreverted' } });

    await expect(submitUserOp(baseParams)).rejects.toThrow('reverted on-chain');
  });

  it('propagates an unrelated bundler error unchanged (not a duplicate signal)', async () => {
    setup({ success: true, receipt: { transactionHash: '0xfresh' } });
    mocks.sendUserOperation.mockRejectedValue(new Error('paymaster deposit too low'));

    await expect(submitUserOp(baseParams)).rejects.toThrow('paymaster deposit too low');
    expect(mocks.getUserOperationReceipt).not.toHaveBeenCalled();
    expect(mocks.waitForUserOperationReceipt).not.toHaveBeenCalled();
  });

  it('resolves concurrent duplicate submits to the same tx hash', async () => {
    setup({ success: true, receipt: { transactionHash: '0xshared' } });
    // A prior broadcast already put this op in flight, so both racing retries see "already known"
    // and each recovers the same op's receipt keyed on userOpHash.
    mocks.sendUserOperation.mockRejectedValue(new Error('already known'));
    mocks.waitForUserOperationReceipt.mockResolvedValue({ success: true, receipt: { transactionHash: '0xshared' } });

    const [a, b] = await Promise.all([submitUserOp(baseParams), submitUserOp(baseParams)]);

    expect(a).toEqual({ srcChainTxHash: '0xshared', alreadyKnown: true });
    expect(b).toEqual({ srcChainTxHash: '0xshared', alreadyKnown: true });
  });
});
