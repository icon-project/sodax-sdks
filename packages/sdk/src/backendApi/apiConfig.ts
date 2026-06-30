// Resolution of the `ApiConfig` union into the concrete per-service config used
// by `BackendApiService` (base/backend API) and `SwapsApiService` (swaps API).
//
// `ApiConfig` (from `@sodax/types`) is one of two shapes:
//   - `BaseApiConfig` — flat `{ baseURL, timeout, headers }`. Both services share it;
//     the swaps endpoints are reached as `/swaps/*` sub-paths under the same base URL.
//   - `CustomApiConfig` — `{ baseApiConfig?, swapsApiConfig? }`. Lets each service point
//     at its own base URL / timeout / headers. Either slice may be omitted.
//
// Both resolvers fill any omitted field from the global backend-API defaults and always
// include the default headers (so a JSON `Content-Type`/`Accept` is present unless
// explicitly overridden). In custom mode the swaps resolver layers `swapsApiConfig` over
// `baseApiConfig` over the defaults, so swaps inherits the base config (including any
// cross-cutting auth/tracing header) for every field `swapsApiConfig` does not override.
// They also normalise the hybrid objects that `mergeSodaxConfig`'s deep-merge can produce
// when a `CustomApiConfig` override is layered onto the flat default — the custom slices
// win and any leftover top-level flat fields (which equal the defaults) are ignored.

import {
  DEFAULT_BACKEND_API_ENDPOINT,
  DEFAULT_BACKEND_API_HEADERS,
  DEFAULT_BACKEND_API_TIMEOUT,
  type ApiConfig,
  type BaseApiConfig,
  type CustomApiConfig,
  type SwapsApiConfig,
} from '@sodax/types';

/**
 * True when `config` is the nested {@link CustomApiConfig} variant (carries a
 * `baseApiConfig` and/or `swapsApiConfig` slice) rather than a flat {@link BaseApiConfig}.
 */
export function isCustomApiConfig(config: ApiConfig): config is CustomApiConfig {
  return 'baseApiConfig' in config || 'swapsApiConfig' in config;
}

/**
 * Layer config slices left→right over the global backend-API defaults (later slices win
 * per field). `baseURL`/`timeout`: the last defined value wins; `headers`: merged across
 * every layer, so a cross-cutting header from an earlier slice (e.g. `baseApiConfig`) is
 * kept unless a later slice overrides that key. The default headers are always present.
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

/**
 * Resolve the effective config for the base (backend) API:
 * - flat {@link BaseApiConfig} → used directly,
 * - {@link CustomApiConfig} → its `baseApiConfig` slice,
 * with omitted fields filled from the defaults.
 */
export function resolveBaseApiConfig(config: ApiConfig): BaseApiConfig {
  if (isCustomApiConfig(config)) {
    return layerConfigs(config.baseApiConfig);
  }
  return layerConfigs(config);
}

/**
 * Resolve the effective config for the swaps API:
 * - flat {@link BaseApiConfig} → shared with the base API (swaps endpoints are sub-paths),
 * - {@link CustomApiConfig} → its `swapsApiConfig` slice **layered over `baseApiConfig`** (the
 *   shared foundation): each field falls back swaps → base → default, and headers merge
 *   defaults → base → swaps so a cross-cutting `baseApiConfig` header (auth/tracing) reaches
 *   swaps calls unless `swapsApiConfig` overrides that key.
 */
export function resolveSwapsApiConfig(config: ApiConfig): SwapsApiConfig {
  if (isCustomApiConfig(config)) {
    return layerConfigs(config.baseApiConfig, config.swapsApiConfig);
  }
  return layerConfigs(config);
}

/**
 * Resolve the effective config for the bridge API. The Bridge API shares the swaps host —
 * its routes are reached as `/bridge/*` sub-paths under the same base URL — so there is no
 * separate `bridgeApiConfig` slice on {@link CustomApiConfig} and no `BridgeApiConfig` type:
 * this is an unconditional alias of {@link resolveBaseApiConfig}.
 */
export function resolveBridgeApiConfig(config: ApiConfig): BaseApiConfig {
  return resolveBaseApiConfig(config);
}
