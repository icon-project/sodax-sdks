import type { RequestOverrideConfig } from '@sodax/dapp-kit';

/**
 * Canary deployment of the Bridge API v2. Passed per-call via each `useBridgeApi*` hook's
 * `apiConfig` so this showcase targets canary without touching the app-wide SDK config.
 *
 * The backend `/bridge/*` routes do not exist yet; until they ship this page's API calls are
 * expected to fail against the live host (the on-chain `bridge/` page remains the working flow).
 */
export const BRIDGE_API_CONFIG = {
  baseURL: 'https://canary-api.sodax.com/v1',
} as const satisfies RequestOverrideConfig;
