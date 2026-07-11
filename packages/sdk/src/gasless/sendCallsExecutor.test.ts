/**
 * Unit tests for the Mode A executor (`executeSendCalls`) — EIP-5792 `wallet_sendCalls`.
 *
 * The wallet is a mock `IGaslessCapableEvmWalletProvider`; asserts the paymaster + atomic
 * capabilities are requested, the bundle status is polled, and a partial/failed bundle never
 * yields a tx hash.
 */

import { describe, expect, it, vi } from 'vitest';
import type { IGaslessCapableEvmWalletProvider } from '@sodax/types';
import { executeSendCalls } from './internal/sendCallsExecutor.js';
import type { GaslessCall } from './internal/buildDepositCalls.js';

const CALLS: GaslessCall[] = [
  { to: '0x0000000000000000000000000000000000000010', data: '0xapprove', value: 0n },
  { to: '0x0000000000000000000000000000000000000020', data: '0xtransfer', value: 0n },
];

function makeWallet(status: unknown) {
  const sendCalls = vi.fn().mockResolvedValue({ id: '0xbundle' });
  const waitForCallsStatus = vi.fn().mockResolvedValue(status);
  const wallet = { chainType: 'EVM', sendCalls, waitForCallsStatus } as unknown as IGaslessCapableEvmWalletProvider;
  return { wallet, sendCalls, waitForCallsStatus };
}

describe('executeSendCalls', () => {
  it('requests atomic + paymaster capabilities and returns the confirmed tx hash', async () => {
    const { wallet, sendCalls } = makeWallet({
      status: 'success',
      statusCode: 200,
      receipts: [{ transactionHash: '0xdeadbeef' }],
    });

    const result = await executeSendCalls({
      wallet,
      calls: CALLS,
      paymasterUrl: 'https://pm',
      paymasterContext: { sponsorshipPolicyId: 'sp_1' },
      chainId: 8453,
    });

    expect(result).toEqual({ srcChainTxHash: '0xdeadbeef' });
    expect(sendCalls).toHaveBeenCalledWith({
      calls: CALLS,
      chainId: 8453,
      capabilities: {
        paymasterService: { url: 'https://pm', context: { sponsorshipPolicyId: 'sp_1' } },
        atomic: { status: 'required' },
      },
    });
  });

  it('throws when the bundle is not confirmed', async () => {
    const { wallet } = makeWallet({ status: 'failure', statusCode: 500, receipts: [] });
    await expect(
      executeSendCalls({ wallet, calls: CALLS, paymasterUrl: 'https://pm', chainId: 8453 }),
    ).rejects.toThrow();
  });

  it('throws when no receipt / tx hash is present', async () => {
    const { wallet } = makeWallet({ status: 'success', statusCode: 200, receipts: undefined });
    await expect(
      executeSendCalls({ wallet, calls: CALLS, paymasterUrl: 'https://pm', chainId: 8453 }),
    ).rejects.toThrow();
  });
});
