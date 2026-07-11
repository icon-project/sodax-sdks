/**
 * Unit tests for gasless capability detection (`detectGaslessCapabilities`).
 */

import { describe, expect, it, vi } from 'vitest';
import type { IGaslessCapableEvmWalletProvider } from '@sodax/types';
import type { PrivateKeyAccount } from 'viem';
import { detectGaslessCapabilities } from './internal/capabilities.js';

const CHAIN = '0x38.bsc';
const OWNER = { address: '0x0000000000000000000000000000000000000001' } as unknown as PrivateKeyAccount;

function walletWithCaps(caps: unknown) {
  return {
    chainType: 'EVM',
    getCapabilities: vi.fn().mockResolvedValue(caps),
  } as unknown as IGaslessCapableEvmWalletProvider;
}

describe('detectGaslessCapabilities', () => {
  it('returns unsupported when the chain is not configured', async () => {
    const result = await detectGaslessCapabilities({ chainKey: CHAIN, chainId: 56, configured: false, owner: OWNER });
    expect(result.resolvedMode).toBe('unsupported');
  });

  it('Mode A: resolves walletCalls when the wallet advertises atomic + paymaster', async () => {
    const wallet = walletWithCaps({ atomic: { status: 'supported' }, paymasterService: { supported: true } });
    const result = await detectGaslessCapabilities({
      chainKey: CHAIN,
      chainId: 56,
      configured: true,
      walletProvider: wallet,
    });
    expect(result).toMatchObject({ resolvedMode: 'walletCalls', atomicSupported: true, paymasterSupported: true });
  });

  it('Mode A: resolves unsupported when paymaster support is missing', async () => {
    const wallet = walletWithCaps({ atomic: { status: 'supported' } });
    const result = await detectGaslessCapabilities({
      chainKey: CHAIN,
      chainId: 56,
      configured: true,
      walletProvider: wallet,
    });
    expect(result).toMatchObject({ resolvedMode: 'unsupported', atomicSupported: true, paymasterSupported: false });
  });

  it('Mode A: resolves unsupported when getCapabilities throws (non-5792 wallet)', async () => {
    const wallet = {
      chainType: 'EVM',
      getCapabilities: vi.fn().mockRejectedValue(new Error('method not supported')),
    } as unknown as IGaslessCapableEvmWalletProvider;
    const result = await detectGaslessCapabilities({
      chainKey: CHAIN,
      chainId: 56,
      configured: true,
      walletProvider: wallet,
    });
    expect(result.resolvedMode).toBe('unsupported');
  });

  it('Mode B: resolves smartAccount for an owner on a configured chain', async () => {
    const result = await detectGaslessCapabilities({ chainKey: CHAIN, chainId: 56, configured: true, owner: OWNER });
    expect(result).toMatchObject({ resolvedMode: 'smartAccount', atomicSupported: true, paymasterSupported: true });
  });
});
