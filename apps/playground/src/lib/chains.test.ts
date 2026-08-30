import { EVM_CHAIN_KEYS, Sodax, getSupportedSolverTokens, spokeChainConfig } from '@sodax/dapp-kit';
import { describe, expect, it } from 'vitest';
import {
  bridgeableChains,
  chainKeyExpression,
  chainName,
  defaultDstChain,
  defaultSrcChain,
  spokeTokens,
  swappableChains,
} from './chains';
import { FLOWS } from './flows';

// These assert the derivation, not a chain list: adding a chain to @sodax/types must be all it takes
// to see it in the pickers, and any chain that reaches one must be swappable and signable.
describe('swappableChains', () => {
  it('offers at least the two chains the defaults need', () => {
    expect(swappableChains.length).toBeGreaterThanOrEqual(2);
  });

  it('offers only EVM chains, because that is the one wallet adapter mounted', () => {
    for (const key of swappableChains) {
      expect(EVM_CHAIN_KEYS).toContain(key);
    }
  });

  it('offers only chains with a spoke config and a non-empty solver token list', () => {
    for (const key of swappableChains) {
      expect(spokeChainConfig[key]).toBeDefined();
      expect(getSupportedSolverTokens(key).length).toBeGreaterThan(0);
    }
  });

  it('omits no EVM chain that qualifies', () => {
    const qualifying = EVM_CHAIN_KEYS.filter(
      key => key in spokeChainConfig && getSupportedSolverTokens(key).length > 0,
    );
    expect([...swappableChains]).toEqual(qualifying);
  });
});

// Bridging is gated on the chain's own token list, not the solver's, so it can reach further than
// swapping — but never less far, or a flow switch would strand the chain the user was already on.
describe('bridgeableChains', () => {
  it('offers only EVM chains with a spoke config and a non-empty token list', () => {
    for (const key of bridgeableChains) {
      expect(EVM_CHAIN_KEYS).toContain(key);
      expect(spokeChainConfig[key]).toBeDefined();
      expect(spokeTokens(key).length).toBeGreaterThan(0);
    }
  });

  it('covers every swappable chain', () => {
    for (const key of swappableChains) {
      expect(bridgeableChains).toContain(key);
    }
  });
});

describe('defaults', () => {
  it.each(FLOWS)('point %s at chains its own picker offers', flow => {
    const offered = flow === 'bridge' ? bridgeableChains : swappableChains;
    expect(offered).toContain(defaultSrcChain(flow));
    expect(offered).toContain(defaultDstChain(flow));
  });

  it.each(FLOWS)('open %s on a cross-chain pair', flow => {
    expect(defaultSrcChain(flow)).not.toBe(defaultDstChain(flow));
  });
});

describe('chainKeyExpression', () => {
  it('renders every offered chain as the ChainKeys expression a reader pastes', () => {
    for (const key of swappableChains) {
      expect(chainKeyExpression(key)).toMatch(/^ChainKeys\.[A-Z0-9_]+$/);
    }
  });
});

describe('chainName', () => {
  it('has a display name for every offered chain', () => {
    for (const key of swappableChains) {
      expect(chainName(key)).toBeTruthy();
    }
  });
});

// The panel renders a speed tier before any quote, so a pair the estimate cannot classify would
// break the form rather than degrade it.
describe('speed tier over the offered pairs', () => {
  it('classifies every pair the pickers can produce', () => {
    const sodax = new Sodax();

    for (const srcChain of swappableChains) {
      for (const dstChain of swappableChains) {
        const srcToken = getSupportedSolverTokens(srcChain)[0];
        const dstToken = getSupportedSolverTokens(dstChain)[0];
        if (!srcToken || !dstToken) continue;

        const { tier, estimatedSeconds } = sodax.swaps.getSwapSpeedTier({ srcToken, dstToken });
        expect(estimatedSeconds).toBeGreaterThan(0);
        expect(['fast', 'normal', 'slow']).toContain(tier);
      }
    }
  });
});
