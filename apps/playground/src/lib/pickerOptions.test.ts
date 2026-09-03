import { CHAIN_KEYS, type ChainKey, getSupportedSolverTokens } from '@sodax/dapp-kit';
import { describe, expect, it } from 'vitest';
import type { TokenChoice } from './chains';
import { assetGroups, filterGroups, tokenOptionId } from './pickerOptions';

// The packaged solver list stands in for the API's here: same shape, offline, and it already spans
// EVM and non-EVM families, which is what the grouping has to survive.
const CHAINS = CHAIN_KEYS.filter(key => getSupportedSolverTokens(key).length > 0);
const CHOICES: TokenChoice[] = CHAINS.flatMap(chain =>
  getSupportedSolverTokens(chain).map(token => ({ chain: chain as ChainKey, token })),
);
const SYMBOL_COUNT = new Set(CHOICES.map(({ token }) => token.symbol)).size;

// The picker addresses a token by id, so a collision silently selects the wrong asset. Two shapes
// collide in the real config: one asset on many chains, and a withdrawOnly entry sharing its
// on-chain address with the token it deprecates.
describe('tokenOptionId', () => {
  it('separates one asset held on two chains', () => {
    const [first, second] = CHAINS;
    expect(tokenOptionId(first, 'USDC')).not.toBe(tokenOptionId(second, 'USDC'));
  });

  it('separates a deprecated entry from the token it shares an address with', () => {
    const [chain] = CHAINS;
    expect(tokenOptionId(chain, 'WBTC')).not.toBe(tokenOptionId(chain, 'WBTC.legacy'));
  });
});

describe('assetGroups', () => {
  it('gives one group per symbol, losing no token', () => {
    const groups = assetGroups(CHOICES);

    expect(groups).toHaveLength(SYMBOL_COUNT);
    expect(groups.reduce((total, group) => total + group.choices.length, 0)).toBe(CHOICES.length);
  });

  it('keeps every group internally one symbol on distinct chains', () => {
    for (const group of assetGroups(CHOICES)) {
      for (const choice of group.choices) {
        expect(choice.token.symbol).toBe(group.symbol);
      }
      expect(new Set(group.choices.map(choice => choice.chain)).size).toBe(group.choices.length);
    }
  });

  // Chain count stands in for the exchange's value sort, so the widest-reaching assets lead.
  it('orders by reach, then alphabetically', () => {
    const groups = assetGroups(CHOICES);

    for (let i = 1; i < groups.length; i++) {
      const previous = groups[i - 1];
      const current = groups[i];
      expect(previous.choices.length).toBeGreaterThanOrEqual(current.choices.length);
      if (previous.choices.length === current.choices.length) {
        expect(previous.symbol.localeCompare(current.symbol)).toBeLessThan(0);
      }
    }
  });
});

describe('filterGroups', () => {
  const groups = assetGroups(CHOICES);

  it('returns everything for an empty query and no network', () => {
    expect(filterGroups(groups, '', undefined)).toHaveLength(groups.length);
  });

  it('matches a symbol case-insensitively', () => {
    const matched = filterGroups(groups, 'usd', undefined);

    expect(matched.length).toBeGreaterThan(0);
    for (const group of matched) {
      expect(group.symbol.toLowerCase()).toContain('usd');
    }
  });

  // Filtering to one network narrows each surviving group to that chain, which is what lets the
  // grid select straight through instead of asking "which chain?" for an answer already given.
  it('narrows every surviving group to the picked network', () => {
    const [network] = CHAINS;
    const matched = filterGroups(groups, '', network);

    expect(matched.length).toBeGreaterThan(0);
    for (const group of matched) {
      expect(group.choices).toHaveLength(1);
      expect(group.choices[0].chain).toBe(network);
    }
  });

  it('drops a group that does not reach the picked network', () => {
    const [network] = CHAINS;
    const offChain = groups.find(group => group.choices.every(choice => choice.chain !== network));
    expect(offChain, 'no asset is absent from the first chain — pick another to keep this meaningful').toBeDefined();

    const symbols = filterGroups(groups, '', network).map(group => group.symbol);
    expect(symbols).not.toContain(offChain?.symbol);
  });

  it('returns nothing for a symbol that does not exist', () => {
    expect(filterGroups(groups, 'not-a-real-asset', undefined)).toHaveLength(0);
  });
});
