# Logging

The SDK routes all of its internal diagnostics through a single `SodaxLogger` instead of calling
`console.*` directly. This lets you silence SDK output or forward it to a structured sink (Sentry,
Pino, Datadog, etc.) without patching globals.

> There are **two** observability seams and they do different jobs. This page covers `logger`, the
> SDK's own diagnostics. React apps also have `createSodaxQueryClient({ onMutationError })` in
> `@sodax/dapp-kit`, which catches failed React Query mutations — see
> [React mutation errors](#not-this-page-react-mutation-errors) at the end. A dApp usually wants both.

## Select a logger at construction

`logger` is a field on `SodaxOptions` — the `Sodax` constructor's parameter type — and is kept off
the `SodaxConfig` data contract because it is a client-side sink, not backend-fetched config. It
accepts a preset name or a custom implementation:

```typescript
import { Sodax } from '@sodax/sdk';

new Sodax();                       // default — same as { logger: 'console' }
new Sodax({ logger: 'console' });  // mirror the SDK's historical console.* behavior
new Sodax({ logger: 'silent' });   // drop all SDK logs
new Sodax({ logger: myLogger });   // forward to your own sink
```

The logger is resolved **once** at construction and held on `ConfigService` outside the swappable
dynamic config. Read it back as `sodax.config.logger`. `await sodax.config.initialize()` refreshes
chain config but **never** replaces the logger — the backend cannot set or overwrite it.

Combine `logger` with the other constructor options freely; the constructor splits it off the data
override before merging, so it never lands in `sodax.instanceConfig`:

```typescript
const sodax = new Sodax({
  logger: myLogger,
  api: { baseApiConfig: { baseURL: 'https://api.sodax.com/v1/be' } },
});
```

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

Note the asymmetry: `error()` takes the thrown value as a **separate second argument**, before
structured `data`, so adapters can attach it as the exception. `warn` / `info` / `debug` take only
`(message, data?)`.

## What the SDK actually logs

The SDK emits far more `error` than anything else, and currently never calls `info`:

| Level   | Call sites | What shows up                                           | Typical adapter mapping         |
| ------- | ---------- | ------------------------------------------------------- | ------------------------------- |
| `error` | 29         | Service-level failures, already wrapped as `SodaxError`  | `captureException`              |
| `warn`  | 10         | Recoverable or degraded paths                            | `captureMessage`, warning level |
| `debug` | 6          | Verbose flow tracing                                     | breadcrumb                      |
| `info`  | 0          | Not currently emitted — implement it, expect no traffic  | breadcrumb                      |

Counts are across the non-test sources in `packages/sdk/src`; re-derive them with
`grep -rn --include='*.ts' 'logger\.error(' packages/sdk/src | grep -v test | wc -l`.

**There is no level-filtering knob.** Every call reaches your sink; filtering is the adapter's job:

```typescript
import type { SodaxLogger } from '@sodax/sdk';

const ORDER = { debug: 0, info: 1, warn: 2, error: 3 } as const;

const atLeast = (min: keyof typeof ORDER, sink: SodaxLogger): SodaxLogger => ({
  debug: (m, d) => { if (ORDER.debug >= ORDER[min]) sink.debug(m, d); },
  info: (m, d) => { if (ORDER.info >= ORDER[min]) sink.info(m, d); },
  warn: (m, d) => { if (ORDER.warn >= ORDER[min]) sink.warn(m, d); },
  error: (m, e, d) => { if (ORDER.error >= ORDER[min]) sink.error(m, e, d); },
});
```

## Errors reaching your sink

SDK failures arrive as [`SodaxError`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/src/errors/SodaxError.ts)
instances. Tag them on `error.feature`, `error.code`, and `error.context.action` rather than parsing
messages. `toJSON()` is the canonical serialization surface and `JSON.stringify(error)` invokes it
automatically, so Pino, Datadog and Winston pick it up with no extra configuration — including the
`bigint` values inside `context`.

See [Errors And Results](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/AGENTS.md#errors-and-results)
for the error contract itself.

## Built-in loggers and resolver

`consoleLogger`, `silentLogger`, and `resolveLogger(option)` are exported from `@sodax/sdk` for
composition — e.g. wrapping the console logger to add a prefix, or resolving a preset name yourself:

```typescript
import { consoleLogger, resolveLogger, type SodaxLogger } from '@sodax/sdk';

const prefixed: SodaxLogger = {
  debug: (m, d) => consoleLogger.debug(`[sodax] ${m}`, d),
  info: (m, d) => consoleLogger.info(`[sodax] ${m}`, d),
  warn: (m, d) => consoleLogger.warn(`[sodax] ${m}`, d),
  error: (m, e, d) => consoleLogger.error(`[sodax] ${m}`, e, d),
};

const resolved = resolveLogger('silent'); // → silentLogger
```

## Example: Sentry (browser)

```typescript
import * as Sentry from '@sentry/react';
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

## Example: structured JSON on a backend

The runnable version of this lives at
[`apps/node/src/logging.ts`](https://github.com/icon-project/sodax-sdks/blob/main/apps/node/src/logging.ts)
(`pnpm --filter node logging`). It needs no private key, no RPC and no network — the backend base URL
points at a closed local port, so you can watch a real internal SDK error travel through the sink.

Newline-delimited JSON on stdout is the wire shape Pino, Winston and the Datadog/CloudWatch agents
consume, so this adapter is dependency-free and swapping in a real logger is a one-line change:

```typescript
import { Sodax, type SodaxLogger } from '@sodax/sdk';

const write = (level: string, message: string, data?: Record<string, unknown>, error?: unknown): void => {
  const line = { level, message, ...(data ?? {}), ...(error !== undefined ? { err: error } : {}) };
  process.stdout.write(`${JSON.stringify(line, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}\n`);
};

const ndjsonLogger: SodaxLogger = {
  debug: (message, data) => write('debug', message, data),
  info: (message, data) => write('info', message, data),
  warn: (message, data) => write('warn', message, data),
  error: (message, error, data) => write('error', message, data, error),
};

const sodax = new Sodax({ logger: ndjsonLogger });
```

## Example: HTTP intake, no vendor SDK

The demo app ships two production-shaped adapters at
[`apps/demo/src/lib/loggers`](https://github.com/icon-project/sodax-sdks/tree/main/apps/demo/src/lib/loggers):
`createDatadogLogger()` (plain HTTP logs intake — no Datadog SDK, no agent) and
`createSentryLogger()` (real `@sentry/react`, lazy-imported, tunnelled).

Three details in `datadogLogger.ts` are what make an adapter safe in production, and they are easy to
miss:

1. **Coerce `bigint` before serializing.** SDK `data` records routinely carry `bigint` token amounts
   and chain IDs. Without a replacer, `JSON.stringify` throws a `TypeError` — and a log call must
   never throw:

   ```typescript
   const bigintReplacer = (_key: string, value: unknown): unknown =>
     typeof value === 'bigint' ? value.toString() : value;
   ```

2. **Serialize the thrown value explicitly**, preferring `toJSON()` so `SodaxError` keeps its
   `feature` / `code` / `context`, and falling back to `{ name, message, stack }` for a plain `Error`.

3. **Fire and forget.** Never `await` the transport inside a log call, and swallow its failures —
   an unreachable intake should drop the line, not surface as an SDK error:

   ```typescript
   void fetch(intakeUrl, { method: 'POST', body, keepalive: true }).catch(() => {});
   ```

To exercise them locally without DNS or a vendor account, the demo runs a zero-dependency mock intake
(`pnpm mock-intake`, port 9009) that the Vite dev server proxies at the same-origin path
`/__intake/*` — same origin means no CORS preflight, localhost means no DNS lookup.

## Coverage and known gaps

All instance services (swap, bridge, money market, DEX, staking, partner, recovery, the spoke
services), `BackendApiService`, and the solver API client route through the configured logger. A small
number of pure utility/static-helper functions (e.g. `shared/utils/*`, `entities/btc/RadfiProvider`,
`entities/solana/utils`) still call `console.*` directly because they have no access to the instance
logger; threading the logger into those is tracked as follow-up.

## Not this page: React mutation errors

`@sodax/dapp-kit` re-exports `SodaxLogger` and forwards `SodaxOptions` through `SodaxProvider`, so
everything above applies unchanged in React. It also has a **second, separate** seam:

```tsx
import { createSodaxQueryClient } from '@sodax/dapp-kit';

const queryClient = createSodaxQueryClient({
  onMutationError: error => Sentry.captureException(error),
});
```

`onMutationError` fires for every failed React Query **mutation** — a UI-level concern — while
`logger` carries the SDK's internal diagnostics. They do not overlap, and a single mutation can opt
out of the global hook with `meta: { silent: true }`. Wire both.

## See also

- [Configure SDK](./CONFIGURE_SDK.md) — the full `SodaxOptions` shape `logger` belongs to.
- [SDK Architecture Reference](./ARCHITECTURE.md) — `Result<T>` and the error convention.
- `analytics` — a different option again: structured, **opt-in** product events, off by default,
  whereas `logger` carries free-form diagnostics and is on by default.
