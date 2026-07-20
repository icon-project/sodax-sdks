/**
 * Unit tests for `prepareUserOp`. The viem `account-abstraction` layer is mocked, so the tests assert
 * the keyless-prepare wiring: gas/paymaster populated without signing the 7702 authorization, the
 * delegation `stateOverride` + unsigned authorization tuple returned when the EOA is not yet
 * delegated, and both omitted when it already delegates to the Simple7702 implementation.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Address, Hex, PublicClient } from 'viem';
import { prepareUserOp } from './internal/prepareUserOp.js';
import type { GaslessCall } from './internal/buildDepositCalls.js';

const mocks = vi.hoisted(() => ({
  toSimple7702SmartAccount: vi.fn(),
  createPaymasterClient: vi.fn(),
  createBundlerClient: vi.fn(),
  getUserOperationHash: vi.fn(),
  prepareUserOperation: vi.fn(),
}));

vi.mock('viem/account-abstraction', () => ({
  toSimple7702SmartAccount: mocks.toSimple7702SmartAccount,
  createPaymasterClient: mocks.createPaymasterClient,
  createBundlerClient: mocks.createBundlerClient,
  getUserOperationHash: mocks.getUserOperationHash,
}));

const SENDER = '0x1111111111111111111111111111111111111111' as Address;
const DELEGATE = '0x000000000000000000000000000000000000e702' as Address;
const CALLS: GaslessCall[] = [
  { to: '0x0000000000000000000000000000000000000010' as Address, data: '0xapprove' as Hex, value: 0n },
  { to: '0x0000000000000000000000000000000000000020' as Address, data: '0xtransfer' as Hex, value: 0n },
];

const setup = () => {
  mocks.toSimple7702SmartAccount.mockResolvedValue({
    entryPoint: { address: '0xEntryPoint', version: '0.8' },
    authorization: { address: DELEGATE },
  });
  mocks.createPaymasterClient.mockReturnValue({});
  mocks.createBundlerClient.mockReturnValue({ prepareUserOperation: mocks.prepareUserOperation });
  mocks.prepareUserOperation.mockResolvedValue({ sender: SENDER, nonce: 5n });
  mocks.getUserOperationHash.mockReturnValue('0xhash');
};

const publicClient = { getTransactionCount: vi.fn().mockResolvedValue(7) } as unknown as PublicClient;

const params = () => ({
  publicClient,
  sender: SENDER,
  calls: CALLS,
  chainId: 56,
  bundlerUrl: 'https://bundler',
  paymasterUrl: 'https://paymaster',
});

afterEach(() => vi.clearAllMocks());

describe('prepareUserOp', () => {
  it('when NOT delegated: injects a delegation stateOverride and returns the unsigned authorization tuple', async () => {
    setup();

    const result = await prepareUserOp(params());

    expect(result.entryPoint).toBe('0xEntryPoint');
    expect(result.userOpHash).toBe('0xhash');
    expect(result.authorization).toEqual({ chainId: 56, address: DELEGATE, nonce: 7 });

    const prepArg = mocks.prepareUserOperation.mock.calls[0][0];
    expect(prepArg.parameters).not.toContain('authorization'); // never signed during keyless prepare
    expect(prepArg.stateOverride).toEqual([{ address: SENDER, code: `0xef0100${DELEGATE.slice(2)}` }]);
  });

  it('when already delegated to the Simple7702 impl: no stateOverride, no authorization tuple', async () => {
    setup();

    const result = await prepareUserOp({ ...params(), delegatedTo: DELEGATE });

    expect(result.authorization).toBeUndefined();
    expect(mocks.prepareUserOperation.mock.calls[0][0].stateOverride).toBeUndefined();
    expect(publicClient.getTransactionCount).not.toHaveBeenCalled();
  });
});
