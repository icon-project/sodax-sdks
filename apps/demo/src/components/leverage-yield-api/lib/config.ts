import type { RequestOverrideConfig } from '@sodax/dapp-kit';

/**
 * Canary deployment of the backend API. The Leverage Yield API v2 endpoints (`/leverage-yield/*`)
 * live under the same base URL as the Swaps API, so this showcase targets canary per-call via each
 * `useLeverageYieldApi*` hook's `apiConfig` without touching the app-wide SDK config.
 */
export const LEVERAGE_YIELD_API_CONFIG = {
  baseURL: 'https://canary-api.sodax.com/v1',
} as const satisfies RequestOverrideConfig;
