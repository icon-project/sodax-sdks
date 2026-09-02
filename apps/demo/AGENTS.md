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
├── constants.ts         # solver env configs (production / staging)
├── pages/               # one folder per feature
│   ├── swaps-sdk/       # intent-based swaps via the SDK (route `/swaps-sdk`)
│   ├── money-market/    # cross-chain lending/borrowing (per-chain route param)
│   ├── bridge/          # cross-chain token transfers
│   ├── dex/             # concentrated liquidity / AMM
│   ├── staking/         # SODA staking
│   ├── partner-fee-claim/
│   └── recovery/        # withdraw stuck hub-wallet assets
├── components/          # feature components grouped by domain (mm, dex, bridge, staking, swaps, bitcoin, shared, ui)
├── hooks/               # demo-specific composite hooks
├── lib/                 # utilities (chains, scan URLs, logging, etc.)
└── zustand/useAppStore  # UI state: selected chain, wallet modal, solver env + Sodax settings overrides
```

## How it wires up

- **Routing.** `App.tsx` defines routes with react-router, every path from the `ROUTES` table in `constants.ts` (named `ROUTES`, not `Routes`, because react-router exports a `Routes` component into the same file). `/` redirects to `ROUTES.SWAPS_SDK`; the legacy `/solver` path redirects there too, so links from before the rename keep working; a `*` catch-all redirects anything unknown rather than showing react-router's unstyled error boundary. All three use `replace` — without it the redirect pushes a history entry and Back bounces straight forward again. Money market uses a `:chainId` route param (defaults to Arbitrum).
- **Providers.** `providers.tsx` is the canonical stack to copy when integrating: `SodaxProvider` → `QueryClientProvider` (via `createSodaxQueryClient`) → `SodaxWalletProvider`. RPC URLs are read from `process.env.*` with public-RPC fallbacks. WalletConnect is opt-in via `VITE_WALLETCONNECT_PROJECT_ID`.
- **Swap solver env switcher + Sodax Settings.** `useAppStore.solverEnvironment` picks between `productionSolverConfig` / `stagingSolverConfig` from `constants.ts`; this is only a swap solver preset, because bridge has no staging preset. The header's "Sodax Settings" modal (`components/shared/SodaxSettingsModal.tsx`) layers per-field overrides on top, grouped by feature rather than by setting kind — **Swap SDK** (the env tabs, submit-tx, solver endpoint, intents contract), **Bridge SDK** (submit-tx, Bridge API base URL), **Partner fee** (fee address + bps, protocol intents contract) and **API endpoints** (gateway, swaps API, key, relayer) — so the swap-only env switch can never read as scoping the bridge rows. Both persist together under `sodax-demo:sodax-settings` (`lib/sodaxSettings.ts`, sanitizing loader), so the env survives reloads. `Providers` rebuilds the app-wide SDK config from env + settings; a new config identity re-creates the SDK in `SodaxProvider`, a fresh query client is created per config (query keys carry no env/endpoint segment), and only the children are keyed — page state resets without tearing down wallet sessions. The Swap SDK Auto submit-tx default keys on the EFFECTIVE solver endpoint (`defaultUseBackendSubmitTx`), not the env label. Bridge SDK Auto follows the SDK default (on) and is not affected by the swap solver env. Order cards stamp `statusEndpoint` from the live instance (`sodax.config.solver.solverApiEndpoint`), so status polls always follow the endpoint the swap actually used. The Bridge API showcase is per-call by nature, but its base URL is now resolved from the modal override, then `VITE_BRIDGE_API_BASE_URL`, then the canary default. - **Partner fee — one setting, four surfaces.** The modal's fee address + bps are the single place a fee is configured (saved as a pair or not at all). `providers.tsx` feeds them to the SDK as the global `SodaxOptions.fee`, which `ConfigService` resolves per feature (`swaps.partnerFee ?? fee`), covering Swap SDK, Bridge SDK, money market and leverage yield. The two API showcase pages cannot use SDK config at all — their routes read a per-request `partnerFee` off the request body — so `components/shared/PartnerFeeFields.tsx` seeds that body field from the same settings, editable per request. The fee is **entered as a percent and stored/sent as basis points** — `PartnerFeeV2` is the wire mirror of the SDK's `PartnerFee`, whose `percentage` is bps — so every field shows the resolved bps beside the input, and 0.01% (1 bp) is the smallest step the inputs accept: `calculatePercentageFeeAmount` does `BigInt(percentage)`, which throws on a fractional bp instead of rounding. **Omitting the field means different things per route** — `/swaps/*` charges nothing, `/bridge/*` falls back to the backend's configured fee — which is why the field hint is per-page and why clearing both inputs is a supported state, not an error. The seed is read once at mount; a settings save remounts the pages through `configKey`, so it re-seeds itself.
- **UI.** Tailwind v4 + Radix primitives + shadcn-style components in `src/components/ui/`.
- **Logos.** Chain logos come from `baseChainInfo[key].logo` (see `chainIdToChainLogo` in `constants.ts`); token logos render via `<TokenIcon symbol=… />` (`components/shared/TokenIcon.tsx`), which resolves the URL with `tokenLogo(symbol)` from the SDK and falls back to the symbol initials. Don't hardcode icon paths.

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
cp example.env .env           # sets VITE_ENABLE_OBSERVABILITY=true
pnpm mock-intake              # terminal A — the local intake
pnpm dev                      # terminal B
# In the browser console: window.__sodaxLog.error('boom', new Error('x'), { a: 1 })
# …or exercise any SDK feature page; internal SDK logs flow through too.
```

Requires `@sentry/react` installed (listed in `package.json`). To send to the **real** services instead, set `VITE_DD_INTAKE_URL` / `VITE_SENTRY_DSN` (drop the tunnel) — then DNS is required, as expected.

## Analytics tracking

The demo enables the SDK's opt-in user-action analytics so every feature flow it exercises is tracked.

- `src/lib/analytics.ts` — `createDemoAnalytics()`: returns the `analytics` option for `new Sodax({ analytics })` (an `AnalyticsConfig` with `level: 'detailed'` and a `tracker` callback). The `tracker` logs each `AnalyticsEvent` to the console (`[Sodax Analytics] feature.action:phase`) and re-dispatches it as a `sodax:analytics` **window CustomEvent** (`ANALYTICS_EVENT_NAME`) so a UI panel can subscribe and render a live feed. A real integrator forwards `event` to their product-analytics backend instead (e.g. `(event) => amplitude.track(event.action, event.data)`).
- Wired in `providers.tsx` via `sodaxConfig.analytics = createDemoAnalytics() ?? false`. Enabled by default; set `VITE_ENABLE_ANALYTICS=false` to disable (the helper returns `undefined`, so the SDK stays on its disabled default).
- **Feature scoping.** Edit the `ANALYTICS_FEATURES` constant in `src/lib/analytics.ts` (kept in code, not env, so it's visible to integrators reading the sample). It is passed straight through as the SDK's `features` allowlist: `undefined` → all features/actions; `{ swap: true, moneyMarket: { actions: ['supply'] } }` → only those (a feature omitted from the object is OFF); array shorthand `['swap']` → fully-tracked features. Gated-out features/actions never reach the `tracker` and their `data` builders never run.
- What flows: every feature's user-action methods emit `start` / `success` / `failure` — exercise any feature page and watch the console / a `sodax:analytics` listener. No demo change is needed as SDK emit-sites are enriched.

## Common pitfalls

- **Chain logos come from `@sodax/types`, not local files.** `baseChainInfo[key].logo` is the single source of truth (a `raw.githubusercontent.com` URL hosted in `packages/assets`). `src/constants.ts` derives `availableChains[].icon` / `EVM_CHAIN_ICONS` / `getChainIcon` / `chainIdToChainLogo` from it — don't reintroduce hardcoded `/chain/*.png` paths (the demo's `public/` has no `chain/` folder, so those 404). The logo URLs only resolve once `packages/assets` is on `main`; on a feature branch, point `CHAIN_LOGO_BASE_URL` at the branch to preview. (`src/lib/chains.ts` is an unused duplicate of the old logic — ignore it.)
- **An API `baseURL` is the gateway root, never a service path.** `api.baseURL` (and every per-call `RequestOverrideConfig.baseURL`) is the origin plus the deployment's version prefix — `DEFAULT_API_BASE_URL` in `@sodax/types`, never a copied literal. The SDK appends each service's own path below it (`/be`, `/swaps`, `/bridge`, `/sponsorships/stellar`), so a segment in the base URL relocates the sibling services too. `providers.tsx` therefore sets `baseApiConfig` **only** when the settings modal overrides the gateway; `swapsApiConfig` **only** when `VITE_SWAPS_API_BASE_URL` or its settings override is present; Bridge SDK API calls follow `baseApiConfig`; the Bridge API showcase passes a per-call base URL resolved from `settings.bridgeApiBaseUrl ?? VITE_BRIDGE_API_BASE_URL ?? canary`; and `sponsoringApiConfig` comes from its `VITE_*` vars alone (the settings modal has no sponsoring field). With no env vars and no overrides, SDK services run against the packaged production gateway while the Bridge API showcase defaults to canary. A `baseURL` that still ends in `/be` is trimmed with a console warning.
- **Node polyfills.** Uses `@bangjelkoski/vite-plugin-node-polyfills` (Bitcoin/Solana deps pull in `buffer`, `crypto`, etc.). If a new dependency requires a polyfill, add it there rather than in app code.
- **Env vars.** `example.env` lists every var the app reads; all are optional. (Reversed name because the root `.gitignore` ignores `.env*` — a `.env.example` here would be untrackable.) Vite-side env vars must be `VITE_*` (e.g. `VITE_WALLETCONNECT_PROJECT_ID`) and be read via `import.meta.env`. The RPC overrides in `providers.tsx` read from `process.env.*` which is replaced at build time — leaving them unset is fine (public fallbacks). **Never put a credential in an unprefixed var:** `vite.config.ts` does `loadEnv(mode, cwd, '')` and inlines the result as `process.env`, so an unprefixed value is baked into the public bundle whenever it is present on the build machine.
- **Sponsoring 401s mean no `x-api-key`.** Both sponsoring endpoints are key-gated, so a `401 Unauthorized` on `<baseURL>/sponsorships/stellar/*` (the Stellar activation path in the swap cards, via `useStellarGate`) is the service rejecting a keyless call. On the packaged gateway, set **`VITE_SODAX_API_KEY`** — the instance-wide key is inherited by sponsoring whenever the call targets a SODAX gateway root. Reserve `VITE_SPONSORING_API_KEY` (which fills `sponsoringApiConfig.apiKey` and wins) for an independently hosted sponsoring service, where the instance-wide key is deliberately withheld. Set the key in `.env` and restart Vite; the env `define` is build-time, so HMR will not pick it up. `VITE_SPONSORING_API_BASE_URL` retargets the service and defaults to the SDK's packaged production endpoint — it is the base URL **including** any version prefix (`https://api.sodax.com/v1` on the gateway, `http://localhost:3011` for a local `sponsoring-api`, which mounts the routes at the bare origin), because the SDK appends only `/sponsorships/stellar/…`. Never hardcode a localhost URL in `providers.tsx`, the demo is deployed.
- **Stellar destinations need the gate, not a bare trustline check.** `useStellarGate` (dapp-kit) resolves three ordered prerequisites on the *destination* account — it must exist (sponsored activation), then hold enough XLM to pay for a trustline, then trust the token — and short-circuits all of the last two for native XLM via `sodax.spoke.stellar.requiresTrustline`. Pairing `useStellarTrustlineCheck` with `useEstablishTrustline` by hand reproduces two real defects: `hasSufficientTrustline` *throws* a Horizon 404 for a non-existent account, so a `!data` test renders "needs a trustline" and offers a button that cannot work; and reading `isPending` instead of `isLoading` leaves a *disabled* query pending forever, so the whole block silently never renders. Pass `amount: payload ? BigInt(...) : undefined` — a `0n` amount disables the trustline query (`enabled: !!amount`) and parks the gate unresolved, i.e. `blocksAction` with nothing on screen. Wire `blocksAction` into the confirm dialog's submit button only, never the `DialogTrigger` that *builds* the payload, or the gate deadlocks. **`blocksAction` is fail-closed on an unknown state** — correctly, since a payment to a non-existent account or of an untrusted asset fails on-chain — so always render `checkFailed` with `error` and a button calling `retry()`. Skip it and a transient Horizon failure shows the user a disabled Swap button with no message at all, which is worse than the warning-only behaviour it replaced. The gate's `address` must stay the connected destination wallet (`useXAccount({ xChainId: <dest chain> })`): activation requires the sponsored account's own signature (a Stellar protocol rule, asserted in the SDK), and `useEstablishTrustline` takes no address at all — it derives one from `walletProvider.getWalletAddress()`, so a free-form recipient would silently trustline the wrong account. The bridge offers activation and trustline in-flow, like the swap cards, because both are remediable by the connected destination wallet; **funding is message-only everywhere** — no client-side action can add XLM to an account, so a button there would be a dead end.
- **Build memory.** Build script sets `--max-old-space-size=8192` because the bundle is large. Don't drop that flag.
- **Don't add business logic here.** This app demos the SDK; real wallet/registration/ToS flows belong in partner apps, not in `demo/`. Prefer `@sodax/dapp-kit` for product flows, and if demo code becomes reusable, move it to `dapp-kit` / SDK rather than burying it here.
- **`useBalances` reads the chain you name, not the chain on the token.** The SDK picks its RPC from the `chainKey` param and the on-chain identifier from `token.address`; it never consults `token.chainKey`, so a token that does not live on that chain reads as `0n` rather than erroring. So `chainKey` and `tokens` must be committed in the **same state update** — derive the token from the chain during render (`useMemo` over the chain's token list, keying your selection by symbol) instead of holding it in its own `useState` that an effect re-resolves, which leaves one committed render pairing the new chain with the old chain's token. See `pages/leverage-yield/page.tsx`; the same applies wherever a chain selector and token selector coexist, and to any `getTokenOnChain(...) ?? token` fallback feeding a balance read (a fallback like that silently reads the wrong chain). (The legacy `useXBalances` behaves the opposite way — it derives the chain from `xTokens[0].chainKey` and ignores the `xChainId` you pass.)
- **Per-intent partner fees must be reflected in the quote.** Leverage-yield deposits charge `DEPOSIT_PARTNER_FEE` (1%, `pages/leverage-yield/page.tsx`) via the leverage-yield domain's per-intent override; `createVaultIntent()` (inside `useLeverageYieldVaultSwap`) deducts the fee from `inputAmount` before the swap, so the quote is requested on the post-fee amount (`adjustAmountByFee(amount, fee, 'exact_input')`). If a fee and its quote drift apart, `minOutputAmount` becomes unfillable and intents never settle.
- **Leverage-yield positions live in the derived hub wallet, never the EOA — on Sonic too.** A leverage deposit always delivers `lsoda*` to `getUserHubWalletAddress(srcAddress, srcChainKey)` (the CREATE3 user-router for a Sonic-sourced deposit, the per-spoke hub wallet otherwise). `useLeverageYieldShareBalances` therefore resolves *every* holder via `getUserHubWalletAddress` — do NOT special-case the hub chain to read `balanceOf(EOA)`, or a Sonic-sourced position reads a stale zero and looks "lost". The withdraw flow spends from the same derived hub wallet, so the two stay consistent.
- **Leverage `lsoda*` shares are NOT recoverable via the Recovery page.** They're hub-only ERC-4626 vault shares, not asset-manager-registered assets, so the recovery `assetManager.transfer` path reverts on them (the wallet shows it as a failed gas estimate / "undefined gas fee"). The SDK's `RecoveryService.fetchHubAssetBalances` now filters them out (by `leverageYield.vaults[].vault` address), so they no longer appear as stranded assets — exit a position via the leverage-yield **withdraw** tab instead.
- **Partner fee claim: never auto-swap a fee token into itself.** The solver can't fill a same-token swap (`outputToken === fee token`), and `createIntentAutoSwap` would still pull the fee into an unfillable, no-deadline intent and lock it. `sodax.partners.feeClaim.swap()` now rejects this up front (`VALIDATION_FAILED`); the `partner-fee-claim` page also disables Claim and shows a warning when the on-chain auto-swap preference equals the selected fee token. To deliver a fee as-is, use the page's **Withdraw Directly** card (`useFeeClaimWithdraw` → `sodax.bridge.bridge` from Sonic; needs a bridge approval to the hub-wallet router, *not* the ProtocolIntents one). To rescue an already-stuck intent, use **Recover Stuck Claim** (`usePartnerCancelIntent` → `ProtocolIntents.cancelIntent(fromToken, toToken)`) — the only authorized cancel, since the intent's creator is the ProtocolIntents contract and the generic `SwapService.cancelIntent` reverts `Unauthorized()`.
