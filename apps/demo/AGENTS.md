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

## Local paymaster proxy (gasless Mode A, no Pimlico key in the browser)

By default the demo's gasless config uses `VITE_PIMLICO_API_KEY`, so the synthesized Pimlico paymaster URL (with the key) is handed to the browser wallet. To keep the key server-side, run the reference ERC-7677 **paymaster proxy** and point the SDK at it instead.

- `scripts/paymaster-proxy.mjs` — zero-dep Node server (`pnpm paymaster-proxy`, port 9010) that reads `PIMLICO_API_KEY` and forwards ERC-7677 `pm_getPaymasterStubData` / `pm_getPaymasterData` (arriving as `POST /<chainId>`) to Pimlico. Demo-only forwarder; a production proxy must validate the UserOperation (only sponsor SODAX `[approve, transfer]`), authenticate, and own the sponsorship policy.
- `providers.tsx` picks the mode: when `VITE_PAYMASTER_PROXY_URL` is set it configures `gasless.paymasterProxyUrl` (no `pimlicoApiKey` in the browser); otherwise it uses `pimlicoApiKey` (direct).

**Unlike the observability harness, this is NOT same-origin.** In Mode A the *wallet* (not the page) fetches the paymaster URL, so `VITE_PAYMASTER_PROXY_URL` must be an **absolute** URL (e.g. `http://localhost:9010`), not a `/__…` Vite-proxy path, and the proxy sends permissive CORS.

**Run:**

```bash
PIMLICO_API_KEY=…  pnpm paymaster-proxy                 # terminal A — the local proxy
VITE_PAYMASTER_PROXY_URL=http://localhost:9010 pnpm dev # terminal B — leave VITE_PIMLICO_API_KEY unset
# Connect an EIP-5792 wallet, run a gasless swap; the wallet hits localhost:9010, never Pimlico.
```

## Analytics tracking

The demo enables the SDK's opt-in user-action analytics so every feature flow it exercises is tracked.

- `src/lib/analytics.ts` — `createDemoAnalytics()`: returns the `analytics` option for `new Sodax({ analytics })` (an `AnalyticsConfig` with `level: 'detailed'` and a `tracker` callback). The `tracker` logs each `AnalyticsEvent` to the console (`[Sodax Analytics] feature.action:phase`) and re-dispatches it as a `sodax:analytics` **window CustomEvent** (`ANALYTICS_EVENT_NAME`) so a UI panel can subscribe and render a live feed. A real integrator forwards `event` to their product-analytics backend instead (e.g. `(event) => amplitude.track(event.action, event.data)`).
- Wired in `providers.tsx` via `sodaxConfig.analytics = createDemoAnalytics() ?? false`. Enabled by default; set `VITE_ENABLE_ANALYTICS=false` to disable (the helper returns `undefined`, so the SDK stays on its disabled default).
- **Feature scoping.** Edit the `ANALYTICS_FEATURES` constant in `src/lib/analytics.ts` (kept in code, not env, so it's visible to integrators reading the sample). It is passed straight through as the SDK's `features` allowlist: `undefined` → all features/actions; `{ swap: true, moneyMarket: { actions: ['supply'] } }` → only those (a feature omitted from the object is OFF); array shorthand `['swap']` → fully-tracked features. Gated-out features/actions never reach the `tracker` and their `data` builders never run.
- What flows: every feature's user-action methods emit `start` / `success` / `failure` — exercise any feature page and watch the console / a `sodax:analytics` listener. No demo change is needed as SDK emit-sites are enriched.

## Common pitfalls

- **Chain logos come from `@sodax/types`, not local files.** `baseChainInfo[key].logo` is the single source of truth (a `raw.githubusercontent.com` URL hosted in `packages/assets`). `src/constants.ts` derives `availableChains[].icon` / `EVM_CHAIN_ICONS` / `getChainIcon` / `chainIdToChainLogo` from it — don't reintroduce hardcoded `/chain/*.png` paths (the demo's `public/` has no `chain/` folder, so those 404). The logo URLs only resolve once `packages/assets` is on `main`; on a feature branch, point `CHAIN_LOGO_BASE_URL` at the branch to preview. (`src/lib/chains.ts` is an unused duplicate of the old logic — ignore it.)
- **Node polyfills.** Uses `@bangjelkoski/vite-plugin-node-polyfills` (Bitcoin/Solana deps pull in `buffer`, `crypto`, etc.). If a new dependency requires a polyfill, add it there rather than in app code.
- **Env vars.** Vite-side env vars must be `VITE_*` (e.g. `VITE_WALLETCONNECT_PROJECT_ID`). The RPC overrides in `providers.tsx` read from `process.env.*` which is replaced at build time — leaving them unset is fine (public fallbacks).
- **Build memory.** Build script sets `--max-old-space-size=8192` because the bundle is large. Don't drop that flag.
- **Don't add business logic here.** This app demos the SDK; real wallet/registration/ToS flows belong in partner apps, not in `demo/`. Prefer `@sodax/dapp-kit` for product flows, and if demo code becomes reusable, move it to `dapp-kit` / SDK rather than burying it here.
- **Balance readers derive the chain from `xToken.chainKey`, not the selected chain.** `EvmXService.getBalances` queries `getWagmiChainId(firstToken.chainKey)`. So on a chain switch, any "keep the same token" logic must re-resolve the selected `XToken` to the **new chain's** instance (match by symbol, return the entry from the new `getSupportedSolverTokens(chain)` list) — never retain the previous `XToken` object, or `useXBalances` fetches the old chain's balance for an unchanged token. Fixed on the leverage-yield page; the same pattern applies wherever a chain selector and token selector coexist.
- **Per-intent partner fees must be reflected in the quote.** Leverage-yield deposits charge `DEPOSIT_PARTNER_FEE` (1%, `pages/leverage-yield/page.tsx`) via the leverage-yield domain's per-intent override; `createVaultIntent()` (inside `useLeverageYieldVaultSwap`) deducts the fee from `inputAmount` before the swap, so the quote is requested on the post-fee amount (`adjustAmountByFee(amount, fee, 'exact_input')`). If a fee and its quote drift apart, `minOutputAmount` becomes unfillable and intents never settle.
- **Leverage-yield positions live in the derived hub wallet, never the EOA — on Sonic too.** A leverage deposit always delivers `lsoda*` to `getUserHubWalletAddress(srcAddress, srcChainKey)` (the CREATE3 user-router for a Sonic-sourced deposit, the per-spoke hub wallet otherwise). `useLeverageYieldShareBalances` therefore resolves *every* holder via `getUserHubWalletAddress` — do NOT special-case the hub chain to read `balanceOf(EOA)`, or a Sonic-sourced position reads a stale zero and looks "lost". The withdraw flow spends from the same derived hub wallet, so the two stay consistent.
- **Leverage `lsoda*` shares are NOT recoverable via the Recovery page.** They're hub-only ERC-4626 vault shares, not asset-manager-registered assets, so the recovery `assetManager.transfer` path reverts on them (the wallet shows it as a failed gas estimate / "undefined gas fee"). The SDK's `RecoveryService.fetchHubAssetBalances` now filters them out (by `leverageYield.vaults[].vault` address), so they no longer appear as stranded assets — exit a position via the leverage-yield **withdraw** tab instead.
- **Partner fee claim: never auto-swap a fee token into itself.** The solver can't fill a same-token swap (`outputToken === fee token`), and `createIntentAutoSwap` would still pull the fee into an unfillable, no-deadline intent and lock it. `sodax.partners.feeClaim.swap()` now rejects this up front (`VALIDATION_FAILED`); the `partner-fee-claim` page also disables Claim and shows a warning when the on-chain auto-swap preference equals the selected fee token. To deliver a fee as-is, use the page's **Withdraw Directly** card (`useFeeClaimWithdraw` → `sodax.bridge.bridge` from Sonic; needs a bridge approval to the hub-wallet router, *not* the ProtocolIntents one). To rescue an already-stuck intent, use **Recover Stuck Claim** (`usePartnerCancelIntent` → `ProtocolIntents.cancelIntent(fromToken, toToken)`) — the only authorized cancel, since the intent's creator is the ProtocolIntents contract and the generic `SwapService.cancelIntent` reverts `Unauthorized()`.
