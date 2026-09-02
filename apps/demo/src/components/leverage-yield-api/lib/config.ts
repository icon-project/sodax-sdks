import type { RequestOverrideConfig } from '@sodax/dapp-kit';

/**
 * Leverage Yield API v2 host, passed per-call via each `useLeverageYieldApi*` hook's `apiConfig` so
 * this showcase can retarget the backend without touching the app-wide SDK config. Point at a local
 * leverage-yield API with `VITE_LEVERAGE_YIELD_API_BASE_URL` (e.g. `http://localhost:3008`, which
 * serves `/leverage-yield/*` with no `/v1` prefix); mirrors `BRIDGE_API_CONFIG`.
 *
 * As everywhere else, the value is the gateway ROOT — the SDK appends `/leverage-yield/*` itself.
 *
 * The scheme is required either way: `makeRequest` concatenates `baseURL + endpoint` and hands the
 * result to `fetch`, so a bare `host:port` parses as an unknown URL scheme rather than a host.
 */
export const LEVERAGE_YIELD_API_CONFIG = {
  baseURL: import.meta.env.VITE_LEVERAGE_YIELD_API_BASE_URL ?? 'https://canary-api.sodax.com/v1',
} as const satisfies RequestOverrideConfig;
