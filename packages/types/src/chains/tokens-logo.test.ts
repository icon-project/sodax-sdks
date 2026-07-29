import { describe, it, expect } from 'vitest';
import { spokeChainConfig, supportedSpokeChains } from './chains.js';
import { TOKEN_LOGO_BASE_URL, tokenLogo, tokenLogoSlug } from './tokens.js';

const allTokens = supportedSpokeChains.flatMap(key => Object.values(spokeChainConfig[key].supportedTokens));

describe('token logos', () => {
  it('resolves a non-empty logo URL for every supported token', () => {
    for (const token of allTokens) {
      expect(tokenLogo(token.symbol), `${token.symbol} is missing a logo`).toBeTruthy();
    }
  });

  it('builds each logo URL from TOKEN_LOGO_BASE_URL and the token slug', () => {
    for (const token of allTokens) {
      expect(tokenLogo(token.symbol)).toBe(`${TOKEN_LOGO_BASE_URL}/${tokenLogoSlug(token.symbol)}.png`);
    }
  });

  it('produces URL- and path-safe filenames (lowercase alphanumeric segments joined by "-")', () => {
    for (const token of allTokens) {
      expect(tokenLogoSlug(token.symbol), token.symbol).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('maps distinct symbols to distinct filenames (no logo collisions)', () => {
    const symbols = [...new Set(allTokens.map(token => token.symbol))];
    const slugs = symbols.map(tokenLogoSlug);
    expect(new Set(slugs).size).toBe(symbols.length);
  });

  it('slugifies awkward symbols deterministically', () => {
    expect(tokenLogoSlug('bnUSD (legacy)')).toBe('bnusd-legacy');
    expect(tokenLogoSlug('AVAX.LL')).toBe('avax-ll');
    expect(tokenLogoSlug('WETH.e')).toBe('weth-e');
  });
});
