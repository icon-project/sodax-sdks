import { describe, expect, it } from 'vitest';
import { ChainKeys } from './chain-keys.js';
import { BOUND_HOSTS, DEPRECATED_BOUND_HOSTS, spokeChainConfig } from './chains.js';

// gh-425: the packaged default carries `apiUrl` only. Inlining the companion hosts here would let
// an `apiUrl`-only override inherit them via `deepMerge` and straddle two environments.
describe('Bound host defaults', () => {
  const radfi = spokeChainConfig[ChainKeys.BITCOIN_MAINNET].radfi;

  it('ships apiUrl only — no companion host may be inlined here', () => {
    expect(radfi.apiUrl).toBe(BOUND_HOSTS.api);
    expect(radfi).not.toHaveProperty('authUrl');
    expect(radfi).not.toHaveProperty('transactionsUrl');
  });

  it('never defaults to a host Bound has announced it is retiring', () => {
    for (const url of [radfi.apiUrl, radfi.umsUrl]) {
      expect(DEPRECATED_BOUND_HOSTS[url]).toBeUndefined();
    }
  });

  it('keeps every packaged host absolute and free of a trailing slash', () => {
    for (const url of [...Object.values(BOUND_HOSTS), radfi.umsUrl]) {
      expect(url).toMatch(/^https:\/\//);
      expect(url.endsWith('/')).toBe(false);
    }
  });
});
