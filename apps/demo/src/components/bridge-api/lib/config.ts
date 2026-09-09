import type { RequestOverrideConfig } from '@sodax/dapp-kit';

/**
 * Bridge API v2 host, passed per-call via each `useBridgeApi*` hook's `apiConfig` so this showcase
 * can retarget the backend without touching the app-wide SDK config. Point at a local bridge-api
 * with `VITE_BRIDGE_API_BASE_URL` (e.g. `http://localhost:3009`, which serves `/bridge/*` with no
 * `/v1` prefix); mirrors `swapsApiConfig` in `providers.tsx`.
 *
 * As everywhere else, the value is the gateway ROOT — the SDK appends `/bridge/*` itself.
 *
 * The scheme is required either way: `makeRequest` concatenates `baseURL + endpoint` and hands the
 * result to `fetch`, so a bare `host:port` parses as an unknown URL scheme rather than a host.
 */
export const BRIDGE_API_CONFIG = {
  baseURL: import.meta.env.VITE_BRIDGE_API_BASE_URL ?? 'https://canary-api.sodax.com/v1',
} as const satisfies RequestOverrideConfig;
