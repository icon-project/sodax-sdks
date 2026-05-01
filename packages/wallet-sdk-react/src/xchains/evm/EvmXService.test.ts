import { describe, it, expect } from 'vitest';
import { ChainKeys } from '@sodax/types';
import { createWagmiConfig } from './EvmXService.js';
import type { EvmTypeConfig } from '@/types/config.js';

// Verifies user-supplied `rpcUrl` from `SodaxWalletConfig.EVM.chains[K]` is
// threaded into wagmi's http transport for the matching chain id. wagmi stores
// the URL on `client.transport.url` (viem http transport), which is what every
// downstream wallet client reads when issuing JSON-RPC calls.

describe('createWagmiConfig — rpcUrl forwarding', () => {
  const evmChains: EvmTypeConfig['chains'] = {
    [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://test-arb-rpc.example' },
    [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://test-eth-rpc.example' },
    [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://test-sonic-rpc.example' },
  };

  it('routes Arbitrum rpcUrl into wagmi http transport (chainId 42161)', () => {
    const config = createWagmiConfig(evmChains);
    const client = config.getClient({ chainId: 42161 });
    expect(client.transport.url).toBe('https://test-arb-rpc.example');
  });

  it('routes Ethereum rpcUrl into wagmi http transport (chainId 1)', () => {
    const config = createWagmiConfig(evmChains);
    const client = config.getClient({ chainId: 1 });
    expect(client.transport.url).toBe('https://test-eth-rpc.example');
  });

  it('routes Sonic rpcUrl into wagmi http transport (chainId 146)', () => {
    const config = createWagmiConfig(evmChains);
    const client = config.getClient({ chainId: 146 });
    expect(client.transport.url).toBe('https://test-sonic-rpc.example');
  });

  it('falls back to viem chain default rpc when chain entry omits rpcUrl', () => {
    const config = createWagmiConfig({
      [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://test-arb-rpc.example' },
      // base intentionally omitted
    });
    const baseClient = config.getClient({ chainId: 8453 });
    // viem's default is undefined → http() picks chain default
    expect(baseClient.transport.url).toBeTruthy();
    expect(baseClient.transport.url).not.toBe('https://test-arb-rpc.example');
  });

  it('falls back to viem chain default when evmChains is undefined', () => {
    const config = createWagmiConfig(undefined);
    const arbClient = config.getClient({ chainId: 42161 });
    expect(arbClient.transport.url).toBeTruthy();
  });

  it('does not leak one chain rpcUrl into another', () => {
    const config = createWagmiConfig(evmChains);
    const arbClient = config.getClient({ chainId: 42161 });
    const ethClient = config.getClient({ chainId: 1 });
    expect(arbClient.transport.url).not.toBe(ethClient.transport.url);
  });
});
