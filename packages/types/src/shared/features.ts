/**
 * The set of high-level SODAX SDK features.
 *
 * Used as a first-class tag across cross-cutting concerns — error reporting
 * (`SodaxError.feature` in `@sodax/sdk`) and analytics ({@link AnalyticsEvent.feature} and
 * per-feature analytics toggles). It lives in `@sodax/types`, the lowest layer, so every package
 * shares one source of truth instead of redefining the list; `@sodax/sdk` re-exports it.
 */
export type SodaxFeature =
  | 'swap'
  | 'moneyMarket'
  | 'bridge'
  | 'staking'
  | 'migration'
  | 'dex'
  | 'partner'
  | 'recovery'
  | 'backend' // backend-API HTTP client layer (BackendApiService / SwapsApiService), not a domain feature
  | 'leverageYield';
