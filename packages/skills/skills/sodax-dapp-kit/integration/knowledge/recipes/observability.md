# Recipe: Observability — global mutation error hook

`createSodaxQueryClient` returns a `QueryClient` pre-wired with a `MutationCache.onError` hook that gives you a single observability seam for every mutation failure across the app. Optional opt-in — if you construct your own `QueryClient`, nothing changes.

## Default behavior

Logs every mutation failure to console as `[sodax] Mutation error: <error>`:

```tsx
import { createSodaxQueryClient } from '@sodax/dapp-kit';

const queryClient = createSodaxQueryClient();
```

## Wire to your own logger

Sentry, Datadog, Pino — any error sink:

```tsx
// @ai-snippets-skip — Sentry 3rd-party import
import { createSodaxQueryClient } from '@sodax/dapp-kit';
import * as Sentry from '@sentry/react';

const queryClient = createSodaxQueryClient({
  onMutationError: (error) => Sentry.captureException(error),
});
```

## Disable the default

If you wire per-hook `onError` callbacks plus a React error boundary, you may not want a duplicated console log:

```tsx
import { createSodaxQueryClient } from '@sodax/dapp-kit';

const queryClient = createSodaxQueryClient({ onMutationError: () => {} });
console.log(queryClient);
```

## Per-mutation opt-out — `meta.silent`

When a single mutation handles its error locally (e.g. its own toast in `onError`) and you don't want a duplicate `[sodax] Mutation error:` log, pass `meta: { silent: true }` on that mutation:

```tsx
import { useSwap } from '@sodax/dapp-kit';

const swap = useSwap({
  mutationOptions: {
    meta: { silent: true },
    onError: (e) => toast.error(e.message),
  },
});
console.log(swap);
```

The global `onMutationError` skips this mutation; everything else still fires through it.

## Bring your own `MutationCache`

If you pass `config.mutationCache`, the factory keeps your cache instance (preserving any `onError` you set on it) and *additionally* subscribes to its event stream to dispatch `onMutationError`. Both handlers fire — neither replaces the other. `meta.silent` is honored in both branches.

```tsx
import { MutationCache } from '@tanstack/react-query';
import { createSodaxQueryClient } from '@sodax/dapp-kit';

const myCache = new MutationCache({ onError: myOwnErrorHandler });
const queryClient = createSodaxQueryClient({ config: { mutationCache: myCache } });
// myOwnErrorHandler runs; sodax onMutationError ALSO runs (unless meta.silent).
```

## Important: this is observability, not prevention

The global hook fires for **every** mutation failure regardless of:
- Whether the consumer caught the rejection with `try/catch`
- Whether the consumer branched on `mutateAsyncSafe`'s `Result.ok`
- Whether the consumer registered a per-hook `onError`

It does **not** detect "unhandled" rejections. If you want to prevent unhandled rejections at the call site, use `mutateAsyncSafe` (see [`mutation-error-handling.md`](mutation-error-handling.md)).

## When to use

- **Sentry/Datadog integration** — single point of capture for all SDK mutation failures.
- **Global error toast** — render-side error toast on top of per-hook handling. Simpler than per-hook `onError`.
- **Debug console mode** — keep the default during local dev for quick visibility.

## When NOT to use

- **You only handle errors per-hook.** The global hook adds noise (duplicate logs). Either disable it entirely or use `meta.silent`.

## Cross-references

- [`mutation-error-handling.md`](mutation-error-handling.md) — call-site error handling (preventing unhandled rejections).
- [`../architecture.md`](../architecture.md) — full design notes on `createSodaxQueryClient`.
