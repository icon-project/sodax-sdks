/**
 * Runnable `SodaxLogger` example for a backend / Node integration.
 *
 * Companion to `packages/sdk/docs/LOGGING.md`. Needs no private key, no RPC and no network:
 * the backend base URL is pointed at a closed local port so the SDK's request path fails
 * immediately and you can watch a real internal error travel through the sink.
 *
 * Run:
 *   pnpm --filter node logging
 *
 * The adapter below is deliberately dependency-free — it writes newline-delimited JSON to
 * stdout, which is the same wire shape Pino, Winston and the Datadog/Cloudwatch agents
 * consume. Swapping in a real logger is a one-line change inside `write`.
 */

import { Sodax, type SodaxLogger } from '@sodax/sdk';

// ─── The adapter ──────────────────────────────────────────────────────────

/**
 * `data` records routinely carry `bigint` token amounts, and `JSON.stringify` throws a
 * `TypeError` on those. A log call must never throw, so coerce them to decimal strings.
 */
const bigintReplacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

/** `SodaxError.toJSON()` is the canonical serialization surface; fall back for anything else. */
function serializeError(error: unknown): unknown {
  if (error && typeof (error as { toJSON?: () => unknown }).toJSON === 'function') {
    return (error as { toJSON: () => unknown }).toJSON();
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function createNdjsonLogger(): SodaxLogger {
  const write = (level: Level, message: string, data?: Record<string, unknown>, error?: unknown): void => {
    const line = {
      level,
      message,
      ...(data ?? {}),
      ...(error !== undefined ? { err: serializeError(error) } : {}),
    };
    // Never throw and never block: a failed log must not take the SDK call down with it.
    try {
      process.stdout.write(`${JSON.stringify(line, bigintReplacer)}\n`);
    } catch {
      /* dropped */
    }
  };

  return {
    debug: (message, data) => write('debug', message, data),
    info: (message, data) => write('info', message, data),
    warn: (message, data) => write('warn', message, data),
    error: (message, error, data) => write('error', message, data, error),
  };
}

// ─── Wiring ───────────────────────────────────────────────────────────────

const logger = createNdjsonLogger();

// `logger` is a client-side option on `SodaxOptions`, resolved once at construction and kept
// off the backend-fetched config — combine it freely with `api` / `chains` / `solver` overrides.
const sodax = new Sodax({
  logger,
  api: {
    // A closed port, so the request fails locally with no network round trip.
    baseApiConfig: { baseURL: 'http://127.0.0.1:1' },
  },
});

async function main(): Promise<void> {
  // The resolved sink is readable back off the config service.
  console.log('logger wired:', sodax.config.logger === logger);

  // Your own lines can share the sink.
  sodax.config.logger.info('starting backend read', { endpoint: 'getChains' });

  // A real internal SDK failure: the backend client logs through the configured sink before
  // the failure surfaces as a `Result`.
  const result = await sodax.api.getChains();

  if (!result.ok) {
    sodax.config.logger.warn('backend read failed as expected', { reason: String(result.error) });
  }
}

main().catch(error => {
  logger.error('unhandled failure in logging example', error);
  process.exitCode = 1;
});
