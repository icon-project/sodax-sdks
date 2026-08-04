/**
 * Tests flat and per-service API config resolution, including sponsoring's
 * independent origin and credential scope.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKEND_API_ENDPOINT,
  DEFAULT_BACKEND_API_HEADERS,
  DEFAULT_BACKEND_API_TIMEOUT,
  type ApiConfig,
} from '@sodax/types';
import { resolveBaseApiConfig, resolveSponsoringApiConfig, resolveSwapsApiConfig } from './apiConfig.js';

// Cast helper: tests intentionally pass partial / post-merge shapes that the strict
// `ApiConfig` type would reject but that arise at runtime via `DeepPartial` overrides.
const asConfig = (c: unknown): ApiConfig => c as ApiConfig;
const D = DEFAULT_BACKEND_API_HEADERS;

describe('resolveBaseApiConfig', () => {
  it('returns a full flat config, merging default headers underneath', () => {
    const resolved = resolveBaseApiConfig(
      asConfig({ baseURL: 'https://base.example', timeout: 11, headers: { 'X-A': '1' } }),
    );
    expect(resolved).toEqual({ baseURL: 'https://base.example', timeout: 11, headers: { ...D, 'X-A': '1' } });
  });

  it('fills omitted fields of a partial flat config from defaults', () => {
    expect(resolveBaseApiConfig(asConfig({ timeout: 5 }))).toEqual({
      baseURL: DEFAULT_BACKEND_API_ENDPOINT,
      timeout: 5,
      headers: { ...D },
    });
  });

  it('returns all defaults for an empty config', () => {
    expect(resolveBaseApiConfig(asConfig({}))).toEqual({
      baseURL: DEFAULT_BACKEND_API_ENDPOINT,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    });
  });

  it('uses the baseApiConfig slice of a CustomApiConfig (ignoring swapsApiConfig)', () => {
    const resolved = resolveBaseApiConfig(
      asConfig({
        baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: { 'X-B': '1' } },
        swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 9, headers: {} },
      }),
    );
    expect(resolved).toEqual({ baseURL: 'https://base.example', timeout: 7, headers: { ...D, 'X-B': '1' } });
  });

  it('falls back to defaults when a CustomApiConfig has no baseApiConfig', () => {
    expect(
      resolveBaseApiConfig(asConfig({ swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 9, headers: {} } })),
    ).toEqual({ baseURL: DEFAULT_BACKEND_API_ENDPOINT, timeout: DEFAULT_BACKEND_API_TIMEOUT, headers: { ...D } });
  });

  it('fills omitted fields of a partial baseApiConfig slice', () => {
    expect(resolveBaseApiConfig(asConfig({ baseApiConfig: { baseURL: 'https://base.example' } }))).toEqual({
      baseURL: 'https://base.example',
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    });
  });

  // A merged config carries the flat fields it started with alongside any slice the consumer added.
  it('keeps top-level flat fields when a slice is present (post-merge shape)', () => {
    const resolved = resolveBaseApiConfig(
      asConfig({
        baseURL: 'https://flat.example',
        timeout: 11,
        headers: { 'X-A': '1' },
        sponsoringApiConfig: { apiKey: 'k' },
      }),
    );
    expect(resolved).toEqual({ baseURL: 'https://flat.example', timeout: 11, headers: { ...D, 'X-A': '1' } });
  });

  it('lets baseApiConfig override the top-level flat fields it defines', () => {
    const resolved = resolveBaseApiConfig(
      asConfig({
        baseURL: 'https://flat.example',
        timeout: 11,
        headers: { 'X-Flat': '1' },
        baseApiConfig: { baseURL: 'https://base.example' },
      }),
    );
    // slice wins on baseURL; the flat layer still supplies what the slice omits
    expect(resolved).toEqual({ baseURL: 'https://base.example', timeout: 11, headers: { ...D, 'X-Flat': '1' } });
  });
});

describe('resolveSwapsApiConfig', () => {
  it('shares a flat config with the base API', () => {
    const resolved = resolveSwapsApiConfig(
      asConfig({ baseURL: 'https://base.example', timeout: 11, headers: { 'X-A': '1' } }),
    );
    expect(resolved).toEqual({ baseURL: 'https://base.example', timeout: 11, headers: { ...D, 'X-A': '1' } });
  });

  it('swapsApiConfig fields override baseApiConfig', () => {
    const resolved = resolveSwapsApiConfig(
      asConfig({
        baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: {} },
        swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 9, headers: { 'X-S': '1' } },
      }),
    );
    expect(resolved).toEqual({ baseURL: 'https://swaps.example', timeout: 9, headers: { ...D, 'X-S': '1' } });
  });

  it('inherits baseApiConfig fields (baseURL, timeout, headers) that swapsApiConfig omits', () => {
    const resolved = resolveSwapsApiConfig(
      asConfig({
        baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: { Authorization: 'tok' } },
        swapsApiConfig: { headers: { 'X-Swaps': '1' } },
      }),
    );
    expect(resolved).toEqual({
      baseURL: 'https://base.example', // inherited from base (swaps omits it)
      timeout: 7, // inherited from base
      headers: { ...D, Authorization: 'tok', 'X-Swaps': '1' }, // base auth header reaches swaps
    });
  });

  it('lets swapsApiConfig headers override baseApiConfig headers per key', () => {
    const resolved = resolveSwapsApiConfig(
      asConfig({
        baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: { 'X-H': 'base', 'X-Only-Base': 'b' } },
        swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 9, headers: { 'X-H': 'swaps' } },
      }),
    );
    expect(resolved.headers['X-H']).toBe('swaps'); // swaps wins for the shared key
    expect(resolved.headers['X-Only-Base']).toBe('b'); // base-only header still inherited
  });

  it('falls back to baseApiConfig when swapsApiConfig is omitted', () => {
    const resolved = resolveSwapsApiConfig(
      asConfig({ baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: { 'X-B': '1' } } }),
    );
    expect(resolved).toEqual({ baseURL: 'https://base.example', timeout: 7, headers: { ...D, 'X-B': '1' } });
  });

  it('falls back to defaults when neither slice is present', () => {
    expect(resolveSwapsApiConfig(asConfig({ baseApiConfig: undefined, swapsApiConfig: undefined }))).toEqual({
      baseURL: DEFAULT_BACKEND_API_ENDPOINT,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    });
  });

  it('fills omitted fields of a partial swapsApiConfig slice', () => {
    expect(resolveSwapsApiConfig(asConfig({ swapsApiConfig: { baseURL: 'https://swaps.example' } }))).toEqual({
      baseURL: 'https://swaps.example',
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    });
  });

  it('inherits top-level flat fields the swaps slice omits (post-merge shape)', () => {
    const resolved = resolveSwapsApiConfig(
      asConfig({
        baseURL: 'https://flat.example',
        timeout: 11,
        headers: { Authorization: 'tok' },
        swapsApiConfig: { headers: { 'X-S': '1' } },
      }),
    );
    expect(resolved).toEqual({
      baseURL: 'https://flat.example',
      timeout: 11,
      headers: { ...D, Authorization: 'tok', 'X-S': '1' },
    });
  });
});

describe('resolveSponsoringApiConfig', () => {
  const SPONSORING_DEFAULT = 'https://api.sodax.com/v1';

  it('defaults to the sponsoring endpoint when no slice is given', () => {
    expect(resolveSponsoringApiConfig(asConfig({}))).toEqual({
      baseURL: SPONSORING_DEFAULT,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    });
  });

  it('NEVER inherits baseURL from the base API — sponsoring is routed to its own host', () => {
    for (const config of [
      asConfig({ baseURL: 'https://backend.mydapp.com/sodax' }),
      asConfig({ baseApiConfig: { baseURL: 'https://backend.mydapp.com/sodax' } }),
      // post-merge shape: flat fields surviving beside the sponsoring slice
      asConfig({ baseURL: 'https://backend.mydapp.com/sodax', sponsoringApiConfig: { apiKey: 'k' } }),
    ]) {
      expect(resolveSponsoringApiConfig(config).baseURL).toBe(SPONSORING_DEFAULT);
    }
  });

  it('NEVER inherits headers from the base API — a credential is scoped to its origin', () => {
    const withAuth = { headers: { Authorization: 'Bearer USER_JWT' } };
    for (const config of [
      asConfig({ baseURL: 'https://backend.mydapp.com/sodax', ...withAuth }),
      asConfig({ baseApiConfig: { baseURL: 'https://backend.mydapp.com/sodax', ...withAuth } }),
      asConfig({ baseURL: 'https://backend.mydapp.com/sodax', ...withAuth, sponsoringApiConfig: { apiKey: 'k' } }),
    ]) {
      expect(resolveSponsoringApiConfig(config).headers).toEqual({ ...D });
      expect(resolveSponsoringApiConfig(config).headers).not.toHaveProperty('Authorization');
    }
  });

  it('DOES inherit timeout — it carries no credential and is origin-agnostic', () => {
    expect(resolveSponsoringApiConfig(asConfig({ baseApiConfig: { timeout: 1234 } })).timeout).toBe(1234);
    expect(resolveSponsoringApiConfig(asConfig({ timeout: 4321 })).timeout).toBe(4321);
    // post-merge shape: the flat timeout is still the one to inherit
    expect(resolveSponsoringApiConfig(asConfig({ timeout: 4321, sponsoringApiConfig: {} })).timeout).toBe(4321);
  });

  it('takes baseURL, timeout and headers from its own slice, which the caller chose for this host', () => {
    expect(
      resolveSponsoringApiConfig(
        asConfig({
          baseApiConfig: { baseURL: 'https://backend.mydapp.com', timeout: 1000, headers: { Authorization: 'leak' } },
          sponsoringApiConfig: { baseURL: 'http://localhost:3011', timeout: 5000, headers: { 'x-trace': 'abc' } },
        }),
      ),
    ).toEqual({
      baseURL: 'http://localhost:3011',
      timeout: 5000,
      headers: { ...D, 'x-trace': 'abc' },
    });
  });

  it('carries apiKey through, and omits the key entirely when unset', () => {
    expect(resolveSponsoringApiConfig(asConfig({ sponsoringApiConfig: { apiKey: 'k' } })).apiKey).toBe('k');
    expect(
      resolveSponsoringApiConfig(asConfig({ sponsoringApiConfig: { baseURL: 'https://x.example' } })),
    ).not.toHaveProperty('apiKey');
  });

  it('leaves base and swaps on the defaults for a sponsoring-only config', () => {
    const config = asConfig({ sponsoringApiConfig: { apiKey: 'k' } });
    const expected = {
      baseURL: DEFAULT_BACKEND_API_ENDPOINT,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    };
    expect(resolveBaseApiConfig(config)).toEqual(expected);
    expect(resolveSwapsApiConfig(config)).toEqual(expected);
  });

  it.each([
    ['a trailing slash', 'https://api.sodax.com/v1/', 'https://api.sodax.com/v1'],
    ['several trailing slashes', 'http://localhost:3011///', 'http://localhost:3011'],
    ['no trailing slash (unchanged)', 'http://localhost:3011', 'http://localhost:3011'],
  ])('normalizes %s on the resolved baseURL', (_label, configured, expected) => {
    expect(resolveSponsoringApiConfig(asConfig({ sponsoringApiConfig: { baseURL: configured } })).baseURL).toBe(
      expected,
    );
  });
});
