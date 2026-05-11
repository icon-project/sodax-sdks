# apps/node-cjs

CommonJS regression harness. Exists to catch interop bugs when consumers `require('@sodax/sdk')` from a CJS app.

Package name: `sodax-commonjs-test`. `tsconfig.json` is explicitly `"module": "CommonJS"` — that's the whole point. Do not switch it to ESM.

## Why this exists

Reproduction for [issue #939](https://github.com/icon-project/sodax-sdks/issues/939): when `@sodax/sdk` is consumed from CJS, Node throws `ERR_PACKAGE_PATH_NOT_EXPORTED` because some transitive deps (e.g. `near-api-js`) are ESM-only and lack a `require` export path.

The single `src/index.ts` script loads `Sodax`, imports `IconWalletProvider`, and reads `spokeChainConfig`. If any of those break under CJS, this app fails to build or run.

Keep it. Do not delete unless the underlying CJS-interop story changes.

## Run

```bash
cd apps/node-cjs
pnpm test       # tsc && node dist/index.js — this is the regression check
# or step-by-step:
pnpm build
pnpm start
```

Expected output: three `loaded` lines (SDK type, wallet provider type, ICON chain name) and the two `*_MAINNET` key values. Any throw is a regression.

## Structure

```
src/index.ts   # the single CJS reproduction script — do not split or expand
```

## Scripts

```bash
pnpm build        # tsc
pnpm start        # node dist/index.js
pnpm test         # build + run (this is the regression check, runs in CI)
pnpm checkTs      # tsc --noEmit
pnpm lint / pretty
```

## Common pitfalls

- **Don't migrate to ESM.** The CommonJS module setting is load-bearing — the whole purpose is to verify CJS consumers work.
- **Don't expand scope.** This is a minimal regression repro, not a demo. Keep `src/index.ts` small; if you need to test new CJS-specific behavior, add another require/import to the same file rather than building out subdirectories.
- **Mock keys only.** The ICON private key in `index.ts` is a hardcoded mock. Do not replace it with a real one — this script doesn't broadcast.
