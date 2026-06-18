import type { SodaxLogger } from '@sodax/dapp-kit';

// Datadog `SodaxLogger` adapter using the plain HTTP logs intake — no Datadog SDK, no agent.
// Each SDK log line becomes one JSON POST to the intake URL. For local testing the URL defaults
// to `/__intake/datadog`, which the Vite dev proxy forwards to the localhost mock server (no DNS).
// In production point `intakeUrl` (or `VITE_DD_INTAKE_URL`) at Datadog's real intake, e.g.
// `https://http-intake.logs.datadoghq.com/api/v2/logs?dd-api-key=<KEY>`.

type DatadogStatus = 'debug' | 'info' | 'warn' | 'error';

export interface DatadogLoggerOptions {
  /** Intake endpoint. Defaults to `VITE_DD_INTAKE_URL` then `/__intake/datadog`. */
  intakeUrl?: string;
  /** Datadog `service` tag. */
  service?: string;
  /** Datadog `ddsource` tag. */
  source?: string;
}

/**
 * JSON replacer that coerces `bigint` to its decimal string. Caller `data` records routinely carry
 * `bigint` amounts (token values, chain IDs); without this `JSON.stringify` throws a `TypeError` and
 * a log call must never throw.
 */
const bigintReplacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

/** Serialize the thrown value so the exception survives JSON transport. */
function serializeError(error: unknown): unknown {
  if (error && typeof (error as { toJSON?: () => unknown }).toJSON === 'function') {
    // SodaxError.toJSON() is the canonical serialization surface.
    return (error as { toJSON: () => unknown }).toJSON();
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

export function createDatadogLogger(options: DatadogLoggerOptions = {}): SodaxLogger {
  const intakeUrl = options.intakeUrl ?? import.meta.env.VITE_DD_INTAKE_URL ?? '/__intake/datadog';
  const service = options.service ?? 'sodax-demo';
  const ddsource = options.source ?? 'browser';

  const send = (status: DatadogStatus, message: string, data?: Record<string, unknown>, error?: unknown): void => {
    const body = {
      ddsource,
      service,
      status,
      message,
      ...(data ?? {}),
      ...(error !== undefined ? { error: serializeError(error) } : {}),
    };
    // Fire-and-forget. A log call must never throw or block the SDK, so swallow transport errors.
    void fetch(intakeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body, bigintReplacer),
      keepalive: true,
    }).catch(() => {
      /* intake unreachable — drop the line rather than surface it */
    });
  };

  return {
    debug: (message, data) => send('debug', message, data),
    info: (message, data) => send('info', message, data),
    warn: (message, data) => send('warn', message, data),
    error: (message, error, data) => send('error', message, data, error),
  };
}
