import { describe, it, expect } from 'vitest';
import { ChainKeys, type Address, type ChainKey, type XToken } from '@sodax/types';
import { estimateSwapSpeedTier, SPEED_TIER_SECONDS } from './speed-tier.js';

// Minimal XToken fixture — only the fields the speed-tier logic reads (chainKey, hubAsset).
const token = (chainKey: ChainKey, hubAsset: Address): XToken =>
  ({
    symbol: 'TKN',
    name: 'Token',
    decimals: 18,
    address: '0x0000000000000000000000000000000000000000',
    chainKey,
    hubAsset,
    vault: '0x0000000000000000000000000000000000000000',
  }) as XToken;

const SODA_HUB = '0x1111111111111111111111111111111111111111' as Address;
const PLAIN_HUB = '0x2222222222222222222222222222222222222222' as Address;

// Predicate stand-in for config.isMoneyMarketReserveHubAsset.
const isSodaAsset = (hubAsset: Address): boolean => hubAsset.toLowerCase() === SODA_HUB.toLowerCase();

describe('estimateSwapSpeedTier', () => {
  it('both tokens sodaAsset-related (non-ETH) → 15s / fast', () => {
    const result = estimateSwapSpeedTier(
      { srcToken: token(ChainKeys.SONIC_MAINNET, SODA_HUB), dstToken: token(ChainKeys.BSC_MAINNET, SODA_HUB) },
      isSodaAsset,
    );
    expect(result).toEqual({ tier: 'fast', estimatedSeconds: SPEED_TIER_SECONDS.sodaAsset });
  });

  it('either token sodaAsset-related (non-ETH) → 15s / fast', () => {
    const srcOnly = estimateSwapSpeedTier(
      { srcToken: token(ChainKeys.SONIC_MAINNET, SODA_HUB), dstToken: token(ChainKeys.BSC_MAINNET, PLAIN_HUB) },
      isSodaAsset,
    );
    expect(srcOnly).toEqual({ tier: 'fast', estimatedSeconds: SPEED_TIER_SECONDS.sodaAsset });

    const dstOnly = estimateSwapSpeedTier(
      { srcToken: token(ChainKeys.SONIC_MAINNET, PLAIN_HUB), dstToken: token(ChainKeys.BSC_MAINNET, SODA_HUB) },
      isSodaAsset,
    );
    expect(dstOnly).toEqual({ tier: 'fast', estimatedSeconds: SPEED_TIER_SECONDS.sodaAsset });
  });

  it('neither token sodaAsset-related → default 35s', () => {
    const result = estimateSwapSpeedTier(
      { srcToken: token(ChainKeys.SONIC_MAINNET, PLAIN_HUB), dstToken: token(ChainKeys.BSC_MAINNET, PLAIN_HUB) },
      isSodaAsset,
    );
    expect(result.estimatedSeconds).toBe(SPEED_TIER_SECONDS.default);
  });

  it('adds the Ethereum penalty once when either leg is on Ethereum', () => {
    const srcEth = estimateSwapSpeedTier(
      { srcToken: token(ChainKeys.ETHEREUM_MAINNET, SODA_HUB), dstToken: token(ChainKeys.BSC_MAINNET, SODA_HUB) },
      isSodaAsset,
    );
    expect(srcEth.estimatedSeconds).toBe(SPEED_TIER_SECONDS.sodaAsset + SPEED_TIER_SECONDS.ethereumPenalty);

    // Both legs Ethereum — penalty still applied only once.
    const bothEth = estimateSwapSpeedTier(
      { srcToken: token(ChainKeys.ETHEREUM_MAINNET, SODA_HUB), dstToken: token(ChainKeys.ETHEREUM_MAINNET, SODA_HUB) },
      isSodaAsset,
    );
    expect(bothEth.estimatedSeconds).toBe(SPEED_TIER_SECONDS.sodaAsset + SPEED_TIER_SECONDS.ethereumPenalty);
  });

  // TODO: once the spec doc pins the exact seconds and tier thresholds, tighten these into
  // exact-value assertions (e.g. slow-tier boundary at 45s for non-soda + ETH).
});
