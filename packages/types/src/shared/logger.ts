/**
 * Unified logging interface for the SDK.
 *
 * The SDK routes all of its internal diagnostics through a `SodaxLogger` instead of
 * calling `console.*` directly, so consumers can redirect or silence SDK output and
 * forward it to a structured sink (Sentry, Pino, Datadog, etc.).
 *
 * Pass one to `new Sodax({ logger })` via {@link SodaxLoggerOption}:
 * - `'console'` — default; mirrors the SDK's historical `console.*` behavior.
 * - `'silent'`  — drop all SDK logs.
 * - a custom `SodaxLogger` — forward to your own sink.
 *
 * `error()` receives the thrown value separately from structured `data` so adapters
 * can attach it as the exception (e.g. `Sentry.captureException(error, { extra: data })`).
 * SDK errors are `SodaxError` instances whose `toJSON()` is the canonical serialization surface.
 */
export interface SodaxLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: unknown, data?: Record<string, unknown>): void;
}

/**
 * Logger configuration accepted by `new Sodax(...)`. Either a built-in preset name or a
 * custom {@link SodaxLogger} implementation. Resolved to a concrete `SodaxLogger` by the SDK.
 */
export type SodaxLoggerOption = SodaxLogger | 'console' | 'silent';
