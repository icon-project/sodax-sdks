import { describe, it, expect } from 'vitest';
import { baseChainInfo, CHAIN_LOGO_BASE_URL } from './chains.js';
import { CHAIN_KEYS } from './chain-keys.js';

describe('baseChainInfo chain logos', () => {
  it('every chain has a logo URL', () => {
    for (const key of CHAIN_KEYS) {
      expect(baseChainInfo[key].logo, `${key} is missing a logo`).toBeTruthy();
    }
  });

  it('each logo URL is built from CHAIN_LOGO_BASE_URL and named by the chain key', () => {
    for (const key of CHAIN_KEYS) {
      expect(baseChainInfo[key].logo).toBe(`${CHAIN_LOGO_BASE_URL}/${key}.png`);
    }
  });

  it('logo URLs are unique per chain', () => {
    const logos = CHAIN_KEYS.map(key => baseChainInfo[key].logo);
    expect(new Set(logos).size).toBe(logos.length);
  });
});
