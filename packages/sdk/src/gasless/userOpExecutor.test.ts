/**
 * Unit tests for the Mode B executor (`executeUserOp`).
 *
 * The viem `account-abstraction` layer is mocked, so the test asserts the wiring: the batch is
 * submitted as a user operation, the receipt's tx hash is extracted, and a reverted user op throws.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrivateKeyAccount, PublicClient } from 'viem';
import { executeUserOp } from './internal/userOpExecutor.js';
import type { GaslessCall } from './internal/buildDepositCalls.js';

const mocks = vi.hoisted(() => ({
  toSimple7702SmartAccount: vi.fn(),
  createPaymasterClient: vi.fn(),
  createBundlerClient: vi.fn(),
  sendUserOperation: vi.fn(),
  waitForUserOperationReceipt: vi.fn(),
}));

vi.mock('viem/account-abstraction', () => ({
  toSimple7702SmartAccount: mocks.toSimple7702SmartAccount,
  createPaymasterClient: mocks.createPaymasterClient,
  createBundlerClient: mocks.createBundlerClient,
}));

const CALLS: GaslessCall[] = [
  { to: '0x0000000000000000000000000000000000000010', data: '0xapprove', value: 0n },
  { to: '0x0000000000000000000000000000000000000020', data: '0xtransfer', value: 0n },
];

const publicClient = {} as unknown as PublicClient;
const owner = { address: '0x0000000000000000000000000000000000000001' } as unknown as PrivateKeyAccount;

afterEach(() => vi.clearAllMocks());

describe('executeUserOp', () => {
  it('submits the batch and extracts the tx hash from the user-operation receipt', async () => {
    mocks.toSimple7702SmartAccount.mockResolvedValue({ address: owner.address });
    mocks.createPaymasterClient.mockReturnValue({});
    mocks.createBundlerClient.mockReturnValue({
      sendUserOperation: mocks.sendUserOperation,
      waitForUserOperationReceipt: mocks.waitForUserOperationReceipt,
    });
    mocks.sendUserOperation.mockResolvedValue('0xuserop');
    mocks.waitForUserOperationReceipt.mockResolvedValue({ success: true, receipt: { transactionHash: '0xhash' } });

    const result = await executeUserOp({
      publicClient,
      owner,
      calls: CALLS,
      bundlerUrl: 'https://bundler',
      paymasterUrl: 'https://pm',
      paymasterContext: { sponsorshipPolicyId: 'sp_1' },
    });

    expect(result).toEqual({ srcChainTxHash: '0xhash' });
    expect(mocks.sendUserOperation).toHaveBeenCalledWith({ calls: CALLS });
    expect(mocks.createBundlerClient).toHaveBeenCalledWith(
      expect.objectContaining({ paymasterContext: { sponsorshipPolicyId: 'sp_1' } }),
    );
  });

  it('throws when the user operation reverts', async () => {
    mocks.toSimple7702SmartAccount.mockResolvedValue({ address: owner.address });
    mocks.createPaymasterClient.mockReturnValue({});
    mocks.createBundlerClient.mockReturnValue({
      sendUserOperation: mocks.sendUserOperation,
      waitForUserOperationReceipt: mocks.waitForUserOperationReceipt,
    });
    mocks.sendUserOperation.mockResolvedValue('0xuserop');
    mocks.waitForUserOperationReceipt.mockResolvedValue({ success: false, receipt: { transactionHash: '0xhash' } });

    await expect(
      executeUserOp({ publicClient, owner, calls: CALLS, bundlerUrl: 'https://bundler', paymasterUrl: 'https://pm' }),
    ).rejects.toThrow();
  });
});
