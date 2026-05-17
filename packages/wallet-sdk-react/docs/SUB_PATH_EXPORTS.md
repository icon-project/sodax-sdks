# Sub-path Exports

`@sodax/wallet-sdk-react` ships a **two-tier export surface**:

- **Barrel** — `import { useXConnect, type IXConnector } from '@sodax/wallet-sdk-react'` exposes hooks, types, the abstract `XConnector` base, and `<SodaxWalletProvider>`.
- **Sub-path** — `import { XverseXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin'` exposes concrete connector / service classes for advanced use (`instanceof` checks, calling chain-specific methods).

The split is deliberate: keeping concrete classes off the barrel prevents accidental coupling to internal implementations and lets the SDK refactor chain code without breaking consumers.

This document covers the build-time plumbing that makes sub-paths work.

## Table of contents

1. [Why two tiers](#why-two-tiers)
2. [What's exported where](#whats-exported-where)
3. [`tsup` multi-entry build](#tsup-multi-entry-build)
4. [`package.json` `exports` + `typesVersions`](#packagejson-exports--typesversions)
5. [`instanceof` semantics across entry points](#instanceof-semantics-across-entry-points)
6. [Common errors and fixes](#common-errors-and-fixes)

---

## Why two tiers

Three reasons:

**1. Coupling control.** A consumer that imports `EvmXConnector` from the barrel implicitly depends on a concrete class. Six months later when the SDK refactors how EVM connectors are constructed (e.g. moves from one connector class per wagmi connector to a polymorphic dispatcher), every consumer that did the deep dependency breaks. Forcing `instanceof` users to deep-import makes the dependency explicit and visible to the SDK author at refactor time.

**2. Tree-shaking efficiency.** The barrel re-exports hooks and types only — small surface area, small bundle. Consumers who never touch `XverseXConnector` don't pay its cost. Sub-path imports pull only the chain they reference.

**3. AI agent / IDE intent signal.** Code reviewers and autocomplete see at a glance whether a file is using "everyday hooks" (barrel) or "chain-specific advanced features" (deep import). The latter typically warrants a closer look.

---

## What's exported where

### Barrel (`@sodax/wallet-sdk-react`)

Everything in `src/index.ts` — hooks, utils, types, interfaces, the `<SodaxWalletProvider>` component, and the abstract `XConnector` / `XService` base classes:

```typescript
// ✅ Barrel imports
import {
  SodaxWalletProvider,
  useXConnect,
  useXAccount,
  useWalletProvider,
  useWalletModal,
  useBatchConnect,
  XConnector,                       // abstract base — for custom connectors
  type IXConnector,                 // interface
  type IXService,                   // interface
  type SodaxWalletConfig,
  type XAccount,
  type XConnection,
  sortConnectors,
} from '@sodax/wallet-sdk-react';
```

### Sub-paths (`@sodax/wallet-sdk-react/xchains/<chain>`)

Concrete classes — one barrel per chain folder:

```typescript
// ✅ Sub-path imports
import { EvmXConnector, EvmXService, createWagmiConfig } from '@sodax/wallet-sdk-react/xchains/evm';
import { SolanaXConnector, SolanaXService } from '@sodax/wallet-sdk-react/xchains/solana';
import { SuiXConnector, SuiXService } from '@sodax/wallet-sdk-react/xchains/sui';
import {
  BitcoinXService,
  BitcoinXConnector,    // abstract
  UnisatXConnector,     // concrete
  XverseXConnector,     // concrete
  OKXXConnector,        // concrete
  useBitcoinXConnectors,
  type BtcWalletAddressType,
} from '@sodax/wallet-sdk-react/xchains/bitcoin';
import { StellarXService, StellarWalletsKitXConnector } from '@sodax/wallet-sdk-react/xchains/stellar';
import { InjectiveXConnector, InjectiveXService } from '@sodax/wallet-sdk-react/xchains/injective';
import { IconXService, IconHanaXConnector, CHAIN_INFO, SupportedChainId } from '@sodax/wallet-sdk-react/xchains/icon';
import { NearXConnector, NearXService } from '@sodax/wallet-sdk-react/xchains/near';
import {
  StacksXService,
  StacksXConnector,
  STACKS_PROVIDERS,
  useStacksXConnectors,
  type StacksProviderConfig,
} from '@sodax/wallet-sdk-react/xchains/stacks';
```

For the full list, see [`CONNECTORS.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONNECTORS.md#sub-path-imports--concrete-classes).

### Concrete chain symbols live only in sub-paths

Concrete connector / service classes — and their named types — are not re-exported from the barrel. Even a `type`-only reference must come from the sub-path; `import type { XverseXConnector } from '@sodax/wallet-sdk-react'` fails with TS2305 / TS2724.

```typescript
// ✅ Sub-path — works for both `type` and runtime use
import { XverseXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin';
import type { BtcWalletAddressType } from '@sodax/wallet-sdk-react/xchains/bitcoin';
```

If a cross-cutting type genuinely needs to be available from the barrel (typing a function param, narrowing a return type), add it as `export type { ... }` in `src/index.ts` — but the default is sub-path-only.

---

## `tsup` multi-entry build

[`tsup.config.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/tsup.config.ts) declares one entry per public boundary:

```typescript
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/xchains/*/index.ts',     // glob — picks up new chain folders automatically
    'src/xchains/*/index.tsx',
  ],
  format: ['esm', 'cjs'],
  outDir: 'dist',
  external: ['react', 'react-dom', '@tanstack/react-query'],
  // ...
});
```

One config produces both formats via two `defineConfig` entries. The ESM entry uses `splitting: true` so chunks are shared across entry points and `instanceof XverseXConnector` works regardless of which entry the connector was imported from. The CJS entry uses `splitting: false` — instanceof across barrel + sub-path entries does not hold in CJS, but in practice browser apps (Vite, Next.js) and Node ESM scripts hit the ESM path.

DTS is generated by tsup's internal `rollup-plugin-dts` integration (`dts: true`), which emits both `.d.ts` and `.d.cts` siblings in one pass. The build script wraps tsup in `NODE_OPTIONS=--max-old-space-size=8192` because rollup-plugin-dts inlines transitive dep types and otherwise OOMs the default V8 heap on this package's type graph.

### Adding a new chain

The glob `src/xchains/*/index.ts` is **auto-discovering** — creating `src/xchains/aptos/index.ts` automatically produces `dist/xchains/aptos/index.{mjs,cjs,d.ts,d.cts}` on next build. No `tsup.config.ts` edit required. See [`ADDING_A_NEW_CHAIN.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/ADDING_A_NEW_CHAIN.md#step-4--xchainschainindexts-barrel-for-sub-path-export).

---

## `package.json` `exports` + `typesVersions`

Two fields work together to support modern bundlers and legacy `moduleResolution: "node"`:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    },
    "./xchains/*": {
      "types": "./dist/xchains/*/index.d.ts",
      "import": "./dist/xchains/*/index.mjs",
      "require": "./dist/xchains/*/index.cjs"
    }
  },
  "typesVersions": {
    "*": {
      "xchains/*": ["./dist/xchains/*/index.d.ts"]
    }
  }
}
```

| Field | Read by | Purpose |
|-------|---------|---------|
| `exports['.']` | All bundlers (Vite, Webpack, esbuild, Next.js), modern Node | Resolves `@sodax/wallet-sdk-react` to the right artifact per condition (ESM/CJS/types) |
| `exports['./xchains/*']` | Same | Wildcard maps `@sodax/wallet-sdk-react/xchains/<chain>` to the matching `dist/xchains/<chain>/index.<ext>` |
| `typesVersions['xchains/*']` | TypeScript with `moduleResolution: "node"` (legacy) | Fallback for TS configs that don't honor the `exports` field's `types` condition |

Modern projects with `"moduleResolution": "bundler"` or `"node16"` only need `exports`. `typesVersions` ensures sub-path types resolve for older configs that still see `@sodax/wallet-sdk-react/xchains/bitcoin` as a path traversal.

If a consumer reports "Cannot find module" for sub-paths in TypeScript, check their `tsconfig.json` `moduleResolution` setting first.

---

## `instanceof` semantics across entry points

Class identity is preserved across barrel and sub-path entries **only in ESM**:

```typescript
// ESM — works
import { XverseXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin';
const connectors = useXConnectors({ xChainType: 'BITCOIN' });
const xverse = connectors.find(c => c instanceof XverseXConnector); // ✅ may be true

// CJS — broken (in theory)
// require('@sodax/wallet-sdk-react') and require('@sodax/wallet-sdk-react/xchains/bitcoin')
// load XverseXConnector from separate compiled files; instanceof returns false.
```

In practice this **doesn't break browser consumers** — Vite, Next.js, esbuild, Webpack all resolve ESM by default. CJS-only Node.js scripts that mix barrel and sub-path imports would hit the issue, but those scripts typically don't need `instanceof XverseXConnector` (they wouldn't run in a browser-extension context).

In practice this is rarely an issue because:
- Browser apps (Vite, Next.js) resolve ESM where rolldown's chunk-sharing keeps classes identical across entries.
- Node CJS consumers benefit from Node's `require()` cache: the same `.cjs` chunk is `require()`d once and the resolved exports are shared across entry points that import it.

If you somehow hit the edge case (same class loaded via two different paths and they don't compare equal), stick to **one** entry point — only the sub-path or only the barrel, never both for the same class — or switch your project to ESM (`"type": "module"` in your `package.json`).

---

## Common errors and fixes

### `Cannot find module '@sodax/wallet-sdk-react/xchains/bitcoin'`

- **TypeScript**: check `moduleResolution` is `"bundler"`, `"node16"`, or `"nodenext"`. Older `"node"` setting needs `typesVersions` (already provided in this package).
- **Bundler**: check `package.json` is being read — some monorepos with custom resolvers ignore `exports`. Verify by adding a console.log of `require.resolve('@sodax/wallet-sdk-react/xchains/bitcoin')`.

### `XverseXConnector is not exported from '@sodax/wallet-sdk-react'`

Expected — concrete connector classes are NOT re-exported from the barrel. Switch to:

```typescript
import { XverseXConnector } from '@sodax/wallet-sdk-react/xchains/bitcoin';
```

The error message can also appear if you tried `import type { XverseXConnector } from '@sodax/wallet-sdk-react'` and then used it as a runtime value — `export type` only covers type position.

### `instanceof XverseXConnector` returns `false` for a connector that should match

Likely a CJS / dual-import issue. Verify that the connector instance came from the same entry point you're testing against. Switching to ESM resolution fixes this for all bundlers.

### `Module not found: '@sodax/wallet-sdk-react/xchains/aptos'` after adding a new chain

Run `pnpm build:packages` — `dist/xchains/aptos/` only exists after a build. The `exports` wildcard resolves at runtime, so consumer apps need the freshly-built artifact.

---

## Related docs

- [Connectors](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONNECTORS.md) — full sub-path map per chain
- [Adding a New Chain](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/ADDING_A_NEW_CHAIN.md) — Step 4 covers the barrel that powers a new sub-path
- [Architecture](https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/ARCHITECTURE.md) — store-first hooks consume only barrel exports
- [tsup reference](https://tsup.egoist.dev/) — bundler config reference
- [Node.js subpath exports](https://nodejs.org/api/packages.html#subpath-exports) — the spec behind `package.json` `exports`
