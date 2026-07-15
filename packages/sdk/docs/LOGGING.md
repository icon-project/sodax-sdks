# Logging

The SDK routes all of its internal diagnostics through a single `SodaxLogger` instead of calling
`console.*` directly. This lets you silence SDK output or forward it to a structured sink (Sentry,
Pino, Datadog, etc.) without patching globals.

## Configuration

Pass `logger` to the `Sodax` constructor. It accepts a preset name or a custom implementation:

```typescript
import { Sodax } from '@sodax/sdk';

new Sodax();                       // default — same as { logger: 'console' }
new Sodax({ logger: 'console' });  // mirror the SDK's historical console.* behavior
new Sodax({ logger: 'silent' });   // drop all SDK logs
new Sodax({ logger: myLogger });   // forward to your own sink
```

The logger is resolved once at construction. It is held independently of the dynamic config, so a
`sodax.config.initialize()` fetch never replaces it.

## Interface

```typescript
interface SodaxLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: unknown, data?: Record<string, unknown>): void;
}

type SodaxLoggerOption = SodaxLogger | 'console' | 'silent';
```

`error()` takes the thrown value separately from structured `data`, so adapters can attach it as the
exception. SDK errors are [`SodaxError`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/src/errors/SodaxError.ts) instances whose `toJSON()` is the
canonical serialization surface — see [error handling in the package README](../CLAUDE.md#error-handling).

## Custom logger example (Sentry)

```typescript
import * as Sentry from '@sentry/node';
import { Sodax, type SodaxLogger } from '@sodax/sdk';

const sentryLogger: SodaxLogger = {
  debug: (message, data) => Sentry.addBreadcrumb({ level: 'debug', message, data }),
  info: (message, data) => Sentry.addBreadcrumb({ level: 'info', message, data }),
  warn: (message, data) => Sentry.captureMessage(message, { level: 'warning', extra: data }),
  error: (message, error, data) =>
    error !== undefined
      ? Sentry.captureException(error, { extra: { message, ...data } })
      : Sentry.captureMessage(message, { level: 'error', extra: data }),
};

const sodax = new Sodax({ logger: sentryLogger });
```

## Built-in loggers

`consoleLogger`, `silentLogger`, and `resolveLogger(option)` are exported from `@sodax/sdk` for
composition (e.g. wrapping the console logger, or resolving a preset name yourself).

## Coverage

All instance services (swap, bridge, money market, DEX, staking, partner, recovery, the spoke
services), `BackendApiService`, and the solver API client route through the configured logger. A small
number of pure utility/static-helper functions (e.g. `shared/utils/*`, `entities/btc/RadfiProvider`,
`entities/solana/utils`) still call `console.*` directly because they have no access to the instance
logger; threading the logger into those is tracked as follow-up.
