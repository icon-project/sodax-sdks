/**
 * Unit tests for the `ApiConfig` union resolvers (`apiConfig.ts`).
 *
 * Exhaustively covers how each `ApiConfig` variant is reduced to a concrete
 * per-service config:
 *   - flat `BaseApiConfig` (full / partial / empty),
 *   - `CustomApiConfig` (both slices / base only / swaps only / partial slices),
 * plus the default-header merge and the swaps→base fallback.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKEND_API_ENDPOINT,
  DEFAULT_BACKEND_API_HEADERS,
  DEFAULT_BACKEND_API_TIMEOUT,
  type ApiConfig,
} from '@sodax/types';
import {
  isCustomApiConfig,
  resolveBaseApiConfig,
  resolveBridgeApiConfig,
  resolveSwapsApiConfig,
} from './apiConfig.js';

// Cast helper: tests intentionally pass partial / post-merge shapes that the strict
// `ApiConfig` type would reject but that arise at runtime via `DeepPartial` overrides.
const asConfig = (c: unknown): ApiConfig => c as ApiConfig;
const D = DEFAULT_BACKEND_API_HEADERS;

describe('isCustomApiConfig', () => {
  it('is false for a flat BaseApiConfig', () => {
    expect(isCustomApiConfig(asConfig({ baseURL: 'https://x.example', timeout: 1, headers: {} }))).toBe(false);
  });

  it('is false for an empty object (treated as flat)', () => {
    expect(isCustomApiConfig(asConfig({}))).toBe(false);
  });

  it('is true when baseApiConfig is present', () => {
    expect(
      isCustomApiConfig(asConfig({ baseApiConfig: { baseURL: 'https://b.example', timeout: 1, headers: {} } })),
    ).toBe(true);
  });

  it('is true when swapsApiConfig is present', () => {
    expect(
      isCustomApiConfig(asConfig({ swapsApiConfig: { baseURL: 'https://s.example', timeout: 1, headers: {} } })),
    ).toBe(true);
  });
});

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
});

describe('resolveBridgeApiConfig', () => {
  // Bridge shares the swaps host: resolveBridgeApiConfig is an unconditional alias of
  // resolveBaseApiConfig — it ignores any swapsApiConfig slice and never reads a
  // (non-existent) bridgeApiConfig slice.
  it('shares a flat config with the base API', () => {
    const config = asConfig({ baseURL: 'https://base.example', timeout: 11, headers: { 'X-A': '1' } });
    expect(resolveBridgeApiConfig(config)).toEqual(resolveBaseApiConfig(config));
    expect(resolveBridgeApiConfig(config)).toEqual({
      baseURL: 'https://base.example',
      timeout: 11,
      headers: { ...D, 'X-A': '1' },
    });
  });

  it('uses the baseApiConfig slice of a CustomApiConfig (ignoring swapsApiConfig)', () => {
    const config = asConfig({
      baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: { 'X-B': '1' } },
      swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 9, headers: { 'X-S': '1' } },
    });
    expect(resolveBridgeApiConfig(config)).toEqual(resolveBaseApiConfig(config));
    expect(resolveBridgeApiConfig(config)).toEqual({
      baseURL: 'https://base.example',
      timeout: 7,
      headers: { ...D, 'X-B': '1' },
    });
  });

  it('falls back to defaults for an empty config', () => {
    expect(resolveBridgeApiConfig(asConfig({}))).toEqual({
      baseURL: DEFAULT_BACKEND_API_ENDPOINT,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    });
  });
});
