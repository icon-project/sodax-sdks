// Public surface of @sodax/swaps-api.
//
// The runtime client (`SwapsApi`) lands in a later stage; the error type and
// config type below are already final public API.
export { SwapsApiError } from './errors.js';
export type { SwapsApiErrorCode, SwapsApiErrorContext } from './errors.js';
export type { SwapsApiConfig } from './config.js';

// The backend Swaps API v2 contract, re-exported type-only so consumers can
// `import type { ISwapsApiV2 } from '@sodax/swaps-api'`.
export type { ISwapsApiV2 } from '@sodax/types';
