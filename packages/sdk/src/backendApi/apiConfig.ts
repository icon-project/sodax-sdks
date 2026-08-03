import {
  DEFAULT_BACKEND_API_ENDPOINT,
  DEFAULT_BACKEND_API_HEADERS,
  DEFAULT_BACKEND_API_TIMEOUT,
  DEFAULT_SPONSORING_API_ENDPOINT,
  type ApiConfig,
  type BaseApiConfig,
  type HttpUrl,
  type SponsoringApiConfig,
  type SwapsApiConfig,
} from '@sodax/types';
import { trimTrailingSlashes } from './api-utils.js';

/**
 * Runtime shape of a resolved `api` config. `mergeSodaxConfig` deep-merges an override into the flat
 * default, so per-service slices arrive alongside surviving top-level flat fields. `ApiConfig` is
 * assignable to this, letting resolution read both without narrowing to one variant.
 */
type LayeredApiConfig = Partial<BaseApiConfig> & {
  baseApiConfig?: Partial<BaseApiConfig>;
  swapsApiConfig?: Partial<SwapsApiConfig>;
  sponsoringApiConfig?: Partial<SponsoringApiConfig>;
};

/** The top-level flat fields, which layer underneath any per-service slice. */
function flatLayer({ baseURL, timeout, headers }: LayeredApiConfig): Partial<BaseApiConfig> {
  return { baseURL, timeout, headers };
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
  const layers: LayeredApiConfig = config;
  return layerConfigs(flatLayer(layers), layers.baseApiConfig);
}

/** Resolve swaps config over base config and global defaults. */
export function resolveSwapsApiConfig(config: ApiConfig): SwapsApiConfig {
  const layers: LayeredApiConfig = config;
  return layerConfigs(flatLayer(layers), layers.baseApiConfig, layers.swapsApiConfig);
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
  const layers: LayeredApiConfig = config;
  const slice = layers.sponsoringApiConfig;
  return {
    baseURL: normalizeBaseURL(slice?.baseURL ?? DEFAULT_SPONSORING_API_ENDPOINT),
    timeout: slice?.timeout ?? resolveBaseApiConfig(config).timeout,
    headers: { ...DEFAULT_BACKEND_API_HEADERS, ...slice?.headers },
    ...(slice?.apiKey === undefined ? {} : { apiKey: slice.apiKey }),
  };
}
