# packages/libs

Internal **dependency-isolation** package. Bundles and re-exports third-party libraries that need non-trivial build workarounds (Turbopack/Next.js 16 incompatibilities — [#1070](https://github.com/icon-project/sodax-frontend/issues/1070)) through stable subpaths so consumer packages don't each duplicate the workaround.

**Not part of the public Sodax API.** Consumed only by `@sodax/sdk`, `@sodax/wallet-sdk-core`, `@sodax/wallet-sdk-react`.

See [`README.md`](README.md) for the subpath table, when-to-add criteria, and the removal checklist for when an upstream cycle is fixed.

## Structure

Folder-per-npm-scope. Three subpaths today, each a tiny barrel that re-exports only the names consumers need:

```
src/
├── stacks/core/index.ts                 → @sodax/libs/stacks/core               (@stacks/transactions + @stacks/network)
├── stacks/connect/index.ts              → @sodax/libs/stacks/connect            (@stacks/connect)
└── injective/wallet-strategy/index.ts   → @sodax/libs/injective/wallet-strategy (@injectivelabs/wallet-strategy)
```

Every barrel opens with a `TODO(#1070)` JSDoc explaining the upstream root cause and the revert condition.

## Build ([`tsup.config.ts`](tsup.config.ts))

Dual ESM + CJS with `.d.ts` / `.d.cts`. Per-subpath `entry` mirrors `package.json` `exports`. Four non-obvious aspects:

1. **`noExternal` is the point.** Every bundled dep is listed there. Consumers import via `@sodax/libs/<subpath>` and must never re-add the dep to their own `noExternal` — `check:no-duplicate-bundling` enforces this in CI.

2. **`stubUnusedPackages` esbuild plugin** swaps transitive deps SODAX doesn't exercise at runtime with empty modules:
   - `@reown/appkit*`, `cross-fetch` — pulled in by `@stacks/connect`; reach Node builtins that crash Turbopack SSR.
   - `@stacks/connect-ui` — UI picker SODAX bypasses by passing `provider` directly to `request({ provider }, …)`. Stub provides explicit named exports because `@stacks/connect` imports them by name; missing names are caught by the drift script below.
   - `@injectivelabs/wallet-{ledger,trezor,magic,turnkey,wallet-connect}` — `await import(…)` calls Turbopack statically analyzes; wallet-ledger's CryptoJS UMD has dead AMD branches Turbopack parses as real imports.

3. **Browser resolution** — `esbuildOptions.platform = 'browser'`, `mainFields: ['browser','module','main']`, `conditions: ['browser','import']`. Lets packages with a `browser` field (axios, …) pick their XHR adapter over Node `http`/`http2`. Both fixes Turbopack crashes and shrinks bundles.

4. **Explicit Node-builtin externals.** `platform: 'browser'` does not auto-externalize Node builtins when source code imports them — `crypto`, `stream`, `http`, `path`, `fs`, … are enumerated in `external`. `libsodium-wrappers-sumo` is also external (broken upstream ESM resolution).

## Drift-detection scripts ([`scripts/`](scripts/))

Both gate CI; treat failures as load-bearing.

- **`verify-stacks-connect-ui-stub.mjs`** runs *before* tsup in `build`. Greps `node_modules/@stacks/connect/dist/**` for `import {…} from '@stacks/connect-ui'`; fails if any name is missing from the stub. On a `@stacks/connect` upgrade that fires this: add the new name to *both* the stub in `tsup.config.ts` *and* `STUB_EXPORTS` in the script.

- **`verify-no-duplicate-bundling.mjs`** runs after `pnpm build:packages` via `check:no-duplicate-bundling`. Greps consumer dists (`packages/{sdk,wallet-sdk-core,wallet-sdk-react}/dist/index.{mjs,cjs}`) for source markers of the bundled deps; fails if a consumer accidentally re-bundled one. When adding a new bundled dep, also add `FORBIDDEN_INLINE_MARKERS` for it — use distinctive function declarations or internal strings, **not** RPC method names that consumer call sites legitimately reference.

## Consumer-side testing

Vitest mocks target the subpath, not the upstream package:

```ts
vi.mock('@sodax/libs/stacks/core', () => ({ … }));
```

See [`packages/sdk/src/shared/services/spoke/StacksSpokeService.test.ts`](../sdk/src/shared/services/spoke/StacksSpokeService.test.ts) for the `vi.importActual` pattern that spreads real exports plus mocked overrides.

## Rules

- **Only add a subpath when the dep needs a non-trivial build workaround.** If npm import "just works" for consumers, it doesn't belong here — see the README's "When to use this package" criteria.
- **Re-export minimally.** Only names consumers use today; expand on demand.
- **Every barrel keeps its `TODO(#1070)` JSDoc** so the revert condition stays co-located with the workaround.
- **Add a drift-detection script for any shape-dependent workaround.** Stubs that assume upstream's named exports break silently on upgrade unless a build-time check exists.
- **Extend `external` when a new bundled dep imports new Node builtins** — missing entries surface as Turbopack crashes downstream, not here.
