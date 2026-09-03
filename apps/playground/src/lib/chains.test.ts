import { CHAIN_KEYS, EVM_CHAIN_KEYS, Sodax, getSupportedSolverTokens, spokeChainConfig } from '@sodax/dapp-kit';
import { describe, expect, it } from 'vitest';
import {
  bridgeChainOr,
  bridgeableChains,
  chainKeyExpression,
  chainName,
  defaultBridgeDstChain,
  defaultBridgeSrcChain,
  isChainKey,
  spokeTokens,
} from './chains';

// A chain key reaches this app from the swaps API and from the URL, and both are strings. Anything
// that gets past this predicate is indexed straight into `baseChainInfo` for a name and a logo.
describe('isChainKey', () => {
  it('accepts every key the SDK ships, EVM and non-EVM alike', () => {
    for (const key of CHAIN_KEYS) {
      expect(isChainKey(key)).toBe(true);
    }
  });

  it.each(['0xdead.notachain', 'BASE_MAINNET', '../../etc/passwd', '', 'toString'])('rejects %j', value => {
    expect(isChainKey(value)).toBe(false);
  });
});

// The parked bridge signs, and EVM is the one wallet family this app ever mounted an adapter for.
describe('bridgeableChains', () => {
  it('offers at least the two chains its defaults need', () => {
    expect(bridgeableChains.length).toBeGreaterThanOrEqual(2);
  });

  it('offers only EVM chains with a spoke config and a non-empty token list', () => {
    for (const key of bridgeableChains) {
      expect(EVM_CHAIN_KEYS).toContain(key);
      expect(spokeChainConfig[key]).toBeDefined();
      expect(spokeTokens(key).length).toBeGreaterThan(0);
    }
  });

  it('omits no EVM chain that qualifies', () => {
    const qualifying = EVM_CHAIN_KEYS.filter(key => key in spokeChainConfig && spokeTokens(key).length > 0);
    expect([...bridgeableChains]).toEqual(qualifying);
  });
});

describe('bridgeChainOr', () => {
  it('resolves a key the derived list offers', () => {
    expect(bridgeChainOr(bridgeableChains[1], bridgeableChains[0])).toBe(bridgeableChains[1]);
  });

  // The derived list is the allowlist — a URL never becomes a chain key on its own.
  it.each(['solana', '0xdead.notachain', undefined])('falls back for %j', value => {
    expect(bridgeChainOr(value, bridgeableChains[0])).toBe(bridgeableChains[0]);
  });
});

describe('bridge defaults', () => {
  it('point at chains the bridge picker offers', () => {
    expect(bridgeableChains).toContain(defaultBridgeSrcChain());
    expect(bridgeableChains).toContain(defaultBridgeDstChain());
  });

  it('open on a cross-chain pair', () => {
    expect(defaultBridgeSrcChain()).not.toBe(defaultBridgeDstChain());
  });
});

describe('chainKeyExpression', () => {
  it('renders every chain the SDK ships as the ChainKeys expression a reader pastes', () => {
    for (const key of CHAIN_KEYS) {
      expect(chainKeyExpression(key)).toMatch(/^ChainKeys\.[A-Z0-9_]+$/);
    }
  });
});

describe('chainName', () => {
  it('has a display name for every chain the SDK ships', () => {
    for (const key of CHAIN_KEYS) {
      expect(chainName(key)).toBeTruthy();
    }
  });
});

// The panel renders a speed tier before any quote, so a pair the estimate cannot classify would
// break the form rather than degrade it. The API's list reaches at least as far as this one.
describe('speed tier over every swappable pair', () => {
  it('classifies every pair the pickers can produce', () => {
    const sodax = new Sodax();
    const chains = CHAIN_KEYS.filter(key => getSupportedSolverTokens(key).length > 0);

    for (const srcChain of chains) {
      for (const dstChain of chains) {
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
