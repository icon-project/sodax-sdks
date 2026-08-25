// Public surface of @sodax/swaps-api.
export { SwapsApi } from './client.js';
export { SwapsApiError } from './errors.js';
export type { SwapsApiErrorCode, SwapsApiErrorContext } from './errors.js';
export type { SwapsApiConfig } from './config.js';
export { API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE } from './http.js';

// The backend Swaps API v2 contract, re-exported type-only so consumers can
// `import type { ISwapsApiV2 } from '@sodax/swaps-api'`.
export type { ISwapsApiV2 } from '@sodax/types';
