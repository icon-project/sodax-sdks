import type { RequestOverrideConfig } from './api-utils.js';

/** Header the Swaps API v2 backend reads for the caller's Bound (Radfi) access token (Bitcoin source). */
export const BOUND_ACCESS_TOKEN_HEADER = 'x-bound-access-token';

/** Per-call swaps-API options. Add new ones here so call sites don't change. */
export type SwapsApiRequestOptions = {
  /** Bound access token, forwarded as the `x-bound-access-token` header (Bitcoin source). */
  boundAccessToken?: string;
};

/**
 * Merge swaps-API `options` (e.g. a Bound token) into a base `RequestOverrideConfig`. An absent
 * option leaves the config unchanged, so callers pass data without branching.
 *
 * @example buildSwapsApiConfig(baseConfig, { boundAccessToken })
 */
export function buildSwapsApiConfig(
  base?: RequestOverrideConfig,
  options?: SwapsApiRequestOptions,
): RequestOverrideConfig {
  const config: RequestOverrideConfig = { ...base };
  if (options?.boundAccessToken) {
    config.headers = { ...config.headers, [BOUND_ACCESS_TOKEN_HEADER]: options.boundAccessToken };
  }
  return config;
}
