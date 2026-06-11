# apps/demo

Vite + React showcase for the full SDK surface. The "kitchen sink" — every feature service in `@sodax/sdk` has a page here exercised through `@sodax/dapp-kit` hooks and `@sodax/wallet-sdk-react`.

Package name: `sodax-demo-v2`. Dev server port: **3000**.

## Run

```bash
pnpm dev:demo                        # from repo root
# or
pnpm --filter sodax-demo-v2 dev
```

Requires `pnpm build:packages` first if the SDK packages haven't been built.

## Structure

```
src/
├── App.tsx              # react-router routes — one route per feature
├── providers.tsx        # SodaxProvider + SodaxWalletProvider + QueryClientProvider stack
├── constants.ts         # solver env configs (production / staging / dev)
├── pages/               # one folder per feature
│   ├── solver/          # intent-based swaps
│   ├── money-market/    # cross-chain lending/borrowing (per-chain route param)
│   ├── bridge/          # cross-chain token transfers
│   ├── dex/             # concentrated liquidity / AMM
│   ├── staking/         # SODA staking
│   ├── partner-fee-claim/
│   └── recovery/        # withdraw stuck hub-wallet assets
├── components/          # feature components grouped by domain (mm, dex, bridge, staking, swaps, bitcoin, shared, ui)
├── hooks/               # demo-specific composite hooks
├── lib/                 # utilities (chains, scan URLs, logging, etc.)
└── zustand/useAppStore  # UI state: selected chain, wallet modal, solver env switcher
```

## How it wires up

- **Routing.** `App.tsx` defines routes with react-router. `/` redirects to `/solver`. Money market uses a `:chainId` route param (defaults to Arbitrum).
- **Providers.** `providers.tsx` is the canonical stack to copy when integrating: `SodaxProvider` → `QueryClientProvider` (via `createSodaxQueryClient`) → `SodaxWalletProvider`. RPC URLs are read from `process.env.*` with public-RPC fallbacks. WalletConnect is opt-in via `VITE_WALLETCONNECT_PROJECT_ID`.
- **Solver env switcher.** `useAppStore.solverEnvironment` picks between `productionSolverConfig` / `stagingSolverConfig` / `devSolverConfig` from `constants.ts`. The `Providers` component re-memoizes the SDK config when this changes.
- **UI.** Tailwind v4 + Radix primitives + shadcn-style components in `src/components/ui/`.

## What this app is for

- Manual QA / smoke testing every feature against a real wallet.
- Reference implementation for partners integrating `@sodax/dapp-kit` — the pages and `providers.tsx` are the "how do I wire this up" answer.

Not production-grade UX. Intentionally exposes raw SDK knobs (solver env, recovery, raw chain IDs) that a real dApp would hide.

## Scripts

```bash
pnpm dev          # vite dev server on :3000
pnpm build        # NODE_OPTIONS=--max-old-space-size=8192 vite build
pnpm preview      # serve built bundle
pnpm checkTs      # tsc --noEmit
pnpm lint         # biome lint --write
pnpm pretty       # biome format --write
```

`pnpm test` is a no-op (`true`) — there are no tests in this app.

## Local observability testing (Sentry + Datadog, no DNS)

A self-contained harness for verifying `SodaxLogger` sinks (`new Sodax({ logger })`) **without DNS or a real Sentry/Datadog account**. Everything stays on localhost.

**How it routes (the no-DNS trick).** The browser only ever POSTs to the same-origin path `/__intake/*`, which the Vite dev proxy (`vite.config.ts`) forwards to a tiny localhost mock-intake server (`scripts/mock-intake.mjs`). Same-origin → no CORS preflight; localhost → no DNS lookup. Sentry reaches it via its `tunnel` option; the Datadog adapter just `fetch`-POSTs to it.

**Pieces:**

- `scripts/mock-intake.mjs` — zero-dep Node server (`pnpm mock-intake`, port 9009) that pretty-prints every Sentry envelope / Datadog record it receives.
- `src/lib/loggers/datadogLogger.ts` — `createDatadogLogger()`: plain HTTP-intake adapter (no Datadog SDK). One JSON POST per log line; `error()` serializes via `SodaxError.toJSON()`.
- `src/lib/loggers/sentryLogger.ts` — `createSentryLogger()`: real `@sentry/react` (lazy-imported) with a dummy DSN + `tunnel`. `debug/info` → breadcrumbs, `warn` → `captureMessage`, `error` → `captureException`.
- `src/lib/loggers/index.ts` — `getObservabilityLogger()`: fans out to console + Datadog + Sentry, gated on `VITE_ENABLE_OBSERVABILITY === 'true'` (else `undefined` → SDK keeps its default console logger). Also exposes the logger on `window.__sodaxLog` for manual triggering from the browser console. Wired into the SDK in `providers.tsx` via `sodaxConfig.logger`.

**Run:**

```bash
cp .env.example .env          # sets VITE_ENABLE_OBSERVABILITY=true
pnpm mock-intake              # terminal A — the local intake
pnpm dev                      # terminal B
# In the browser console: window.__sodaxLog.error('boom', new Error('x'), { a: 1 })
# …or exercise any SDK feature page; internal SDK logs flow through too.
```

Requires `@sentry/react` installed (listed in `package.json`). To send to the **real** services instead, set `VITE_DD_INTAKE_URL` / `VITE_SENTRY_DSN` (drop the tunnel) — then DNS is required, as expected.

## Common pitfalls

- **Node polyfills.** Uses `@bangjelkoski/vite-plugin-node-polyfills` (Bitcoin/Solana deps pull in `buffer`, `crypto`, etc.). If a new dependency requires a polyfill, add it there rather than in app code.
- **Env vars.** Vite-side env vars must be `VITE_*` (e.g. `VITE_WALLETCONNECT_PROJECT_ID`). The RPC overrides in `providers.tsx` read from `process.env.*` which is replaced at build time — leaving them unset is fine (public fallbacks).
- **Build memory.** Build script sets `--max-old-space-size=8192` because the bundle is large. Don't drop that flag.
- **Don't add business logic here.** This app demos the SDK; real wallet/registration/ToS flows belong in partner apps, not in `demo/`.
- **Balance readers derive the chain from `xToken.chainKey`, not the selected chain.** `EvmXService.getBalances` queries `getWagmiChainId(firstToken.chainKey)`. So on a chain switch, any "keep the same token" logic must re-resolve the selected `XToken` to the **new chain's** instance (match by symbol, return the entry from the new `getSupportedSolverTokens(chain)` list) — never retain the previous `XToken` object, or `useXBalances` fetches the old chain's balance for an unchanged token. Fixed on the leverage-yield page; the same pattern applies wherever a chain selector and token selector coexist.
- **Per-intent partner fees must be reflected in the quote.** Leverage-yield deposits charge `DEPOSIT_PARTNER_FEE` (1%, `pages/leverage-yield/page.tsx`) via the leverage-yield domain's per-intent override; `createVaultIntent()` (inside `useLeverageYieldVaultSwap`) deducts the fee from `inputAmount` before the swap, so the quote is requested on the post-fee amount (`adjustAmountByFee(amount, fee, 'exact_input')`). If a fee and its quote drift apart, `minOutputAmount` becomes unfillable and intents never settle.
