import type { SodaxLogger } from '@sodax/dapp-kit';

// Sentry `SodaxLogger` adapter built on the real `@sentry/react` SDK, so the envelopes you inspect
// locally are exactly what production would send. The `tunnel` option routes every envelope to a
// URL of our choosing instead of the DSN's ingest host — here `/__intake/sentry`, which the Vite
// dev proxy forwards to the localhost mock server. That means NO DNS lookup and no real account:
// the DSN only has to be well-formed, it is never contacted.
//
// `@sentry/react` is imported lazily so the demo still builds/runs when the package isn't installed
// and observability is left off. Calls made before the SDK finishes loading are queued on `ready`.

export interface SentryLoggerOptions {
  /** Well-formed (but unused, when tunneling) DSN. Defaults to `VITE_SENTRY_DSN` then a dummy. */
  dsn?: string;
  /** Tunnel endpoint. Defaults to `VITE_SENTRY_TUNNEL` then `/__intake/sentry`. */
  tunnel?: string;
}

type SentryModule = typeof import('@sentry/react');

const DUMMY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

export function createSentryLogger(options: SentryLoggerOptions = {}): SodaxLogger {
  const dsn = options.dsn ?? import.meta.env.VITE_SENTRY_DSN ?? DUMMY_DSN;
  const tunnel = options.tunnel ?? import.meta.env.VITE_SENTRY_TUNNEL ?? '/__intake/sentry';

  let sentry: SentryModule | undefined;
  const ready: Promise<void> = import('@sentry/react')
    .then(mod => {
      mod.init({
        dsn,
        tunnel,
        tracesSampleRate: 0,
        // Drop ALL default integrations. This kills the automatic "session" (release-health)
        // envelopes that otherwise spam the intake on page load / tab focus, leaving only the
        // events we explicitly capture. Manual `addBreadcrumb`/`captureMessage`/`captureException`
        // are core APIs and keep working without the default integrations.
        defaultIntegrations: false,
      });
      sentry = mod;
    })
    .catch(err => {
      console.warn('[sodax-obs] Sentry disabled — failed to load @sentry/react (is it installed?)', err);
    });

  // Run `fn` now if Sentry is loaded, otherwise once it finishes loading. A log call never throws.
  const run = (fn: (s: SentryModule) => void): void => {
    if (sentry) {
      fn(sentry);
    } else {
      void ready.then(() => sentry && fn(sentry));
    }
  };

  return {
    debug: (message, data) => run(s => s.addBreadcrumb({ level: 'debug', message, data })),
    info: (message, data) => run(s => s.addBreadcrumb({ level: 'info', message, data })),
    warn: (message, data) => run(s => s.captureMessage(message, { level: 'warning', extra: data })),
    error: (message, error, data) =>
      run(s =>
        error !== undefined
          ? s.captureException(error, { extra: { message, ...(data ?? {}) } })
          : s.captureMessage(message, { level: 'error', extra: data }),
      ),
  };
}
