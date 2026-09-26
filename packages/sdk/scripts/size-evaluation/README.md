# SDK size evaluation harness

Measurement-only tooling behind [`SIZE_OPTIMIZATION_EVALUATION.md`](../../docs/SIZE_OPTIMIZATION_EVALUATION.md).
It is not a workspace package, is excluded from the SDK's Biome config and `files`, is never published, and
changes no SDK source.

## What it does

Every number in the report comes from `results/*.json`, which these scripts write:

| Script | Measures |
| --- | --- |
| `measure/baseline.mjs` | Common import shapes from the published flat `dist/` vs the SDK module graph; `@sodax/types` duplication |
| `measure/dupes.mjs` | Packages bundled in more than one version |
| `measure/scenarios.mjs` | Consumer profiles at L1 (pluggable providers) and L2 (leak-free) |
| `measure/marginal.mjs` | Marginal cost of each chain provider and each feature provider (L2) |
| `measure/libalts.mjs` | Each chain library's used surface today vs slimmer entry points / replacement libraries |
| `measure/l3.mjs` | Consumer profiles at L3 (L2 + lighter chain libraries) |
| `measure/config-split.mjs` | How much per-chain token config splitting could save |
| `measure/node-import.mjs` | Node cold-import time and heap of the published dist |
| `measure/tables.mjs` | Renders `results/tables.md` from the JSON |
| `measure/why.mjs` | Debug aid: shortest import chain that keeps a package in a projected bundle |

Bundles are built with the esbuild that `tsup` already brings in: browser platform, ESM, minified, tree-shaken,
node built-ins external (polyfills are not counted). Sizes are raw minified bytes, gzip level 9 and brotli
quality 11.

Projections are modelled on the real source graph rather than estimated: modules a modular SDK would no longer
import are replaced with empty stubs at bundle time, and replacement libraries are represented by the snippets
in `alternatives/`, which exercise the same API surface the SDK uses today. `scenarios.mjs` documents exactly
which files and imports each level removes.

## Run it

```bash
pnpm i && npx turbo build --filter=@sodax/sdk...   # from the repo root: the baseline needs packages/sdk/dist
cd packages/sdk/scripts/size-evaluation
npm i            # measurement-only alternative libraries, pinned in package.json
npm run measure  # ~15 minutes; writes results/*.json and results/tables.md
node measure/node-import.mjs
```

`npm i` here installs outside the workspace, so the repo's pnpm supply-chain settings (release-age cooldown,
trust policy) do not apply to it. Review the pinned versions before installing; nothing from this folder is
bundled into any published package.

Debugging a projection, e.g. why a package survives in the EVM-only core:

```bash
node measure/why.mjs 2 - - @pancakeswap/v3-sdk bn.js
```
