import type { RequestOverrideConfig } from '@sodax/dapp-kit';

/**
 * Canary deployment of the Swaps API v2. Passed per-call via each `useSwapsApi*` hook's
 * `apiConfig` so this showcase targets canary without touching the app-wide SDK config.
 */
export const SWAPS_API_CONFIG = {
  baseURL: 'https://canary-api.sodax.com/v1',
} as const satisfies RequestOverrideConfig;
