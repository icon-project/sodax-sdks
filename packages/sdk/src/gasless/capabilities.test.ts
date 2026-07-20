/**
 * Unit tests for Mode-A gasless wallet capability detection (`detectWalletCapabilities`).
 */

import { describe, expect, it, vi } from 'vitest';
import type { IGaslessCapableEvmWalletProvider } from '@sodax/types';
import { detectWalletCapabilities } from './internal/capabilities.js';

const CHAIN = '0x38.bsc';

function walletWithCaps(caps: unknown) {
  return {
    chainType: 'EVM',
    getCapabilities: vi.fn().mockResolvedValue(caps),
  } as unknown as IGaslessCapableEvmWalletProvider;
}

describe('detectWalletCapabilities', () => {
  it('returns unsupported when the chain is not configured', async () => {
    const result = await detectWalletCapabilities({
      chainKey: CHAIN,
      chainId: 56,
      configured: false,
      walletProvider: walletWithCaps({ atomic: { status: 'supported' }, paymasterService: { supported: true } }),
    });
    expect(result.resolvedMode).toBe('unsupported');
  });

  it('resolves walletCalls when the wallet advertises atomic + paymaster', async () => {
    const wallet = walletWithCaps({ atomic: { status: 'supported' }, paymasterService: { supported: true } });
    const result = await detectWalletCapabilities({ chainKey: CHAIN, chainId: 56, configured: true, walletProvider: wallet });
    expect(result).toMatchObject({ resolvedMode: 'walletCalls', atomicSupported: true, paymasterSupported: true });
  });

  it('resolves unsupported when paymaster support is missing', async () => {
    const wallet = walletWithCaps({ atomic: { status: 'supported' } });
    const result = await detectWalletCapabilities({ chainKey: CHAIN, chainId: 56, configured: true, walletProvider: wallet });
    expect(result).toMatchObject({ resolvedMode: 'unsupported', atomicSupported: true, paymasterSupported: false });
  });

  it('resolves unsupported when getCapabilities throws (non-5792 wallet)', async () => {
    const wallet = {
      chainType: 'EVM',
      getCapabilities: vi.fn().mockRejectedValue(new Error('method not supported')),
    } as unknown as IGaslessCapableEvmWalletProvider;
    const result = await detectWalletCapabilities({ chainKey: CHAIN, chainId: 56, configured: true, walletProvider: wallet });
    expect(result.resolvedMode).toBe('unsupported');
  });
});
