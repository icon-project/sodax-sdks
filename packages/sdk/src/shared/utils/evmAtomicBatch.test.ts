import { describe, expect, it, vi } from 'vitest';
import type { IEvmWalletProvider } from '@sodax/types';
import { canSendAtomicBatch, readAtomicBatchSupport, type AtomicBatchEvmWalletProvider } from './evmAtomicBatch.js';

const baseProvider: IEvmWalletProvider = {
  chainType: 'EVM',
  getWalletAddress: async () => '0x0000000000000000000000000000000000000001',
  sendTransaction: async () => '0xtx',
  waitForTransactionReceipt: vi.fn(),
};

const batchProvider = (getAtomicBatchSupport: AtomicBatchEvmWalletProvider['getAtomicBatchSupport']) => ({
  ...baseProvider,
  getAtomicBatchSupport,
  sendAtomicBatch: vi.fn(),
  waitForBatch: vi.fn(),
});

describe('canSendAtomicBatch', () => {
  it('accepts a provider implementing all three batch methods', () => {
    expect(canSendAtomicBatch(batchProvider(async () => 'supported'))).toBe(true);
  });

  it('rejects a provider without them, or with only some', () => {
    expect(canSendAtomicBatch(baseProvider)).toBe(false);
    expect(canSendAtomicBatch({ ...baseProvider, getAtomicBatchSupport: async () => 'supported' })).toBe(false);
  });
});

describe('readAtomicBatchSupport', () => {
  it.each(['supported', 'ready', 'unsupported'] as const)('passes through %s', async support => {
    await expect(
      readAtomicBatchSupport(
        batchProvider(async () => support),
        8453,
      ),
    ).resolves.toBe(support);
  });

  it('forwards the chain id', async () => {
    const getAtomicBatchSupport = vi.fn(async () => 'ready' as const);
    await readAtomicBatchSupport(batchProvider(getAtomicBatchSupport), 42161);
    expect(getAtomicBatchSupport).toHaveBeenCalledWith(42161);
  });

  it('treats a wallet that cannot answer as unsupported', async () => {
    const throwing = batchProvider(async () => {
      throw new Error('Method not found');
    });
    await expect(readAtomicBatchSupport(throwing, 8453)).resolves.toBe('unsupported');
  });
});
