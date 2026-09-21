import type { SodaxLogger, SodaxLoggerOption } from '@sodax/types';

/**
 * Default logger. Mirrors the SDK's historical `console.*` behavior so existing consumers
 * see no change when they don't pass a `logger`. `data` is appended only when present to keep
 * single-arg log lines unchanged.
 */
export const consoleLogger: SodaxLogger = {
  debug: (message, data) => (data ? console.debug(message, data) : console.debug(message)),
  info: (message, data) => (data ? console.info(message, data) : console.info(message)),
  warn: (message, data) => (data ? console.warn(message, data) : console.warn(message)),
  error: (message, error, data) => {
    if (error !== undefined && data !== undefined) console.error(message, error, data);
    else if (error !== undefined) console.error(message, error);
    else console.error(message);
  },
};

/** No-op logger. Drops every SDK log line. Selected via `new Sodax({ logger: 'silent' })`. */
export const silentLogger: SodaxLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Resolve a {@link SodaxLoggerOption} (a preset name, a custom logger, or `undefined`) into a
 * concrete {@link SodaxLogger}. Defaults to {@link consoleLogger} so logging is on unless opted out.
 */
export function resolveLogger(option: SodaxLoggerOption | undefined): SodaxLogger {
  if (option === undefined || option === 'console') return consoleLogger;
  if (option === 'silent') return silentLogger;
  return option;
}
