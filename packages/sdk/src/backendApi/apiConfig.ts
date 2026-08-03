import {
  DEFAULT_BACKEND_API_ENDPOINT,
  DEFAULT_BACKEND_API_HEADERS,
  DEFAULT_BACKEND_API_TIMEOUT,
  DEFAULT_SPONSORING_API_ENDPOINT,
  type ApiConfig,
  type BaseApiConfig,
  type CustomApiConfig,
  type HttpUrl,
  type SponsoringApiConfig,
  type SwapsApiConfig,
} from '@sodax/types';
import { trimTrailingSlashes } from './api-utils.js';

/** Whether config uses per-service slices. */
export function isCustomApiConfig(config: ApiConfig): config is CustomApiConfig {
  return 'baseApiConfig' in config || 'swapsApiConfig' in config || 'sponsoringApiConfig' in config;
}

/**
 * Layer slices left to right. Scalar values use the latest definition while
 * headers merge by key.
 */
function layerConfigs(...slices: Array<Partial<BaseApiConfig> | undefined>): BaseApiConfig {
  return slices.reduce<BaseApiConfig>(
    (acc, slice) =>
      slice
        ? {
            baseURL: slice.baseURL ?? acc.baseURL,
            timeout: slice.timeout ?? acc.timeout,
            headers: { ...acc.headers, ...slice.headers },
          }
        : acc,
    {
      baseURL: DEFAULT_BACKEND_API_ENDPOINT,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...DEFAULT_BACKEND_API_HEADERS },
    },
  );
}

/** Resolve base API config with global defaults. */
export function resolveBaseApiConfig(config: ApiConfig): BaseApiConfig {
  if (isCustomApiConfig(config)) {
    return layerConfigs(config.baseApiConfig);
  }
  return layerConfigs(config);
}

/** Resolve swaps config over base config and global defaults. */
export function resolveSwapsApiConfig(config: ApiConfig): SwapsApiConfig {
  if (isCustomApiConfig(config)) {
    return layerConfigs(config.baseApiConfig, config.swapsApiConfig);
  }
  return layerConfigs(config);
}

function isHttpUrl(value: string): value is HttpUrl {
  return value.startsWith('http://') || value.startsWith('https://');
}

/** Normalize an observable base URL while preserving its `HttpUrl` type. */
function normalizeBaseURL(baseURL: HttpUrl): HttpUrl {
  const trimmed = trimTrailingSlashes(baseURL);
  return isHttpUrl(trimmed) ? trimmed : baseURL;
}

/**
 * Resolve the effective config for the sponsoring API.
 *
 * Base URL and headers never inherit from the base API because sponsoring uses
 * a separate origin; inheriting could leak credentials. Timeout may inherit.
 * Normalize the URL because callers observe it and config caching keys on it.
 */
export function resolveSponsoringApiConfig(config: ApiConfig): SponsoringApiConfig {
  const slice = isCustomApiConfig(config) ? config.sponsoringApiConfig : undefined;
  const base = isCustomApiConfig(config) ? config.baseApiConfig : config;
  return {
    baseURL: normalizeBaseURL(slice?.baseURL ?? DEFAULT_SPONSORING_API_ENDPOINT),
    timeout: slice?.timeout ?? base?.timeout ?? DEFAULT_BACKEND_API_TIMEOUT,
    headers: { ...DEFAULT_BACKEND_API_HEADERS, ...slice?.headers },
    ...(slice?.apiKey === undefined ? {} : { apiKey: slice.apiKey }),
  };
}
