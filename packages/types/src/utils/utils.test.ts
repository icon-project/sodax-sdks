import { describe, it, expect } from 'vitest';
import { ChainKeys } from '../chains/index.js';
import { getEvmChainKeyByChainId } from './utils.js';

describe('getEvmChainKeyByChainId', () => {
  it('maps wagmi chainId 42161 to ARBITRUM_MAINNET', () => {
    expect(getEvmChainKeyByChainId(42161)).toBe(ChainKeys.ARBITRUM_MAINNET);
  });

  it('maps 1 to ETHEREUM_MAINNET', () => {
    expect(getEvmChainKeyByChainId(1)).toBe(ChainKeys.ETHEREUM_MAINNET);
  });

  it('maps 146 to SONIC_MAINNET (hub)', () => {
    expect(getEvmChainKeyByChainId(146)).toBe(ChainKeys.SONIC_MAINNET);
  });

  it('maps 8453 to BASE_MAINNET', () => {
    expect(getEvmChainKeyByChainId(8453)).toBe(ChainKeys.BASE_MAINNET);
  });

  it('maps 137 to POLYGON_MAINNET', () => {
    expect(getEvmChainKeyByChainId(137)).toBe(ChainKeys.POLYGON_MAINNET);
  });

  it('returns undefined for unknown chainId', () => {
    expect(getEvmChainKeyByChainId(999_999)).toBeUndefined();
  });

  it('returns undefined for missing chainId', () => {
    expect(getEvmChainKeyByChainId(undefined)).toBeUndefined();
  });
});
