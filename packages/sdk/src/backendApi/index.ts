// Re-export only the request-config TYPES that consumers depend on (e.g.
// @sodax/dapp-kit imports `RequestOverrideConfig`). These were public on `main`
// when they lived in BackendApiService.ts; the api-utils extraction must keep
// them exported. The runtime helpers (`makeRequest`, `toJsonBody`) stay
// package-internal — they were never part of the public API.
export type { ApiResponse, RequestConfig, RequestOverrideConfig } from './api-utils.js';
export * from './BackendApiService.js';
export * from './SwapsApiService.js';
export * from './swapsApiConfig.js';
