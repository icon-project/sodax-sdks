# apps/stellar-sponsor-example

Vite + React reference app for **sponsored Stellar account activation** through `@sodax/dapp-kit`. It is the runnable counterpart to `packages/sdk/docs/SPONSORING.md`, and the only example app that depends on `@sodax/dapp-kit`.

Package name: `stellar-sponsor-example`. Dev server port: **3003**. Mock backend port: **9011**.

## Two views

Hash-routed, so a link is shareable and the built bundle needs no SPA rewrite rule.

| View | Hash | Owns |
| --- | --- | --- |
| Showcase | `#/showcase` | The complete three-step journey an integrator copies |
| Test lab | `#/lab` | Diagnostics: target switching, the scenario runner, the event log |

The lab is gated behind `import.meta.env.DEV || VITE_ENABLE_LAB === 'true'` — it holds a real-mainnet switch, and a partner deploying this app should not hand that to their users.

## Run

```bash
cp example.env .env           # sets VITE_SPONSORING_API_KEY=mock-dev-key
pnpm mock-sponsoring          # terminal A — offline sponsoring + Horizon double, port 9011
pnpm dev                      # terminal B — http://localhost:3003
# open the Test lab view and press Run all: every failure class runs offline, for free
```

**How it routes (the no-DNS trick).** The browser only ever talks to the same-origin paths `/__sponsor/*` and `/__horizon/*`, which the Vite dev proxy (`vite.config.ts`) forwards to the localhost mock. Same-origin → no CORS preflight; localhost → no DNS. Same pattern as `apps/demo`'s mock-intake.

## Structure

```text
scripts/mock-sponsoring/   # zero-dep Node http double
├── server.mjs             # routing, api-key gate, control plane, logging
├── scenarios.mjs          # PURE response builders + the catalog
├── horizon.mjs            # PURE Horizon account fixtures
├── scenarios.test.mjs     # node --test over the pure builders
└── server-routing.test.mjs # node --test over route() — spawns the server on port 0
src/
├── App.tsx                # shell: header, ViewTabs, view switch
├── providers.tsx          # LabProvider -> SodaxProvider -> QueryClientProvider -> SodaxWalletProvider
├── lib/                   # journey reducer, stellarTokens, format, explorer, sponsorErrors, useHashView
├── components/            # Button, Card, ErrorNote, HashLink, CopyButton, ViewTabs, SponsorConfigPanel
│   └── journey/           # StageProgress, ActivateStage, FundStage, TrustlineStage, ReadyCard, AccountFactsCard
├── views/ShowcaseView.tsx # owns the reads and mutations; delegates ordering to resolveStellarGate
└── lab/                   # labConfig, LabContext, log, scenarios, runner, useMockHealth, components/
```

Primitive → component, so the mapping stays discoverable:

| SDK primitive | Where it is exercised |
| --- | --- |
| `useActivateStellarAccount` | `components/journey/ActivateStage.tsx`, `lab/components/ScenarioRunner.tsx` |
| `useStellarAccountStatus` | `views/ShowcaseView.tsx`, `components/journey/AccountFactsCard.tsx` |
| `useStellarAccountActive` | `lab/components/DiagnosticsPanel.tsx` (beside the status read — the contrast is the point) |
| `useStellarTrustlineCheck` | `views/ShowcaseView.tsx` |
| `useEstablishTrustline` | `components/journey/TrustlineStage.tsx` |
| `useSponsorConfig` | `components/SponsorConfigPanel.tsx` |
| `resolveStellarGate` | `lib/journey.ts` |
| `classifySponsorError` | `lab/components/ScenarioRunner.tsx` |
| `sodax.api.sponsoring.*` | `lab/components/ScenarioRunner.tsx` (wire tier) |

## The three ordered steps

Activation makes an account able to **receive**, not to **send**. Sponsored create uses `startingBalance: 0`, so the sponsor covers the account entry and the account itself holds nothing.

1. **Activate** — free to the user; the sponsor pays the base reserve.
2. **Receive XLM** — needs no trustline and costs the recipient nothing. This is what makes the account able to act.
3. **Add trustlines** — now affordable, because the account holds XLM.

`lib/journey.ts` projects these onto display stages, delegating the ordering invariant to `resolveStellarGate`.

## Common pitfalls

- **Mainnet only, and it is enforced.** `buildSponsoredCreate` asserts the public-network passphrase *before any wallet prompt*, and `assertSignedByAccount` re-parses under `Networks.PUBLIC`. A successful activation spends real XLM. Exercise the failure paths first — they cost nothing.
- **`alreadyActive` is a SUCCESS.** Never render it as a no-op failure. It arrives both from the client pre-flight (`attempts: 0`) and from the server's race handling.
- **The showcase owns the hooks on purpose.** A *product* app should call `useStellarGate`. This app calls the hooks individually because teaching them is its job — and because the gate's `activate()` drops `onSignatureRequired`, which is what powers the re-sign banner. Only the pure reducer is borrowed, so stage order cannot drift from what ships.
- **Affordability is measured against `availableBalanceStroops`**, never the total. Every subentry locks a base reserve, so total balance overstates what an account can spend. Render the threshold from `status.trustlineMinXlmStroops`, not the exported `STELLAR_TRUSTLINE_MIN_XLM_STROOPS`: the base reserve is a network setting the SDK reads from Horizon, and the constant is only its fallback — showing the constant beside a differing live gate would tell a user to send an amount that still leaves them blocked.
- **`isLoading`, never `isPending`.** A disabled query stays pending forever, which renders as a permanent spinner before a wallet is connected.
- **Trustline exemption comes from `sodax.spoke.stellar.requiresTrustline`**, never a symbol comparison — it covers legacy bnUSD as well as native XLM. The token list comes from `spokeChainConfig[ChainKeys.STELLAR_MAINNET]`.
- **Trustline amounts are 7-decimal stroops**, not the token's own `decimals`; `hasSufficientTrustline` compares against a hard `×1e7`. The amount sizes the *check* only — `changeTrust` is submitted with no limit.
- **An amount of `0n` disables the trustline check** (`enabled: !!amount`), parking the gate permanently unresolved. Default it to something positive.
- **Vite's dev proxy answers an unreachable upstream with its own HTTP 500**, which classifies as `contactOperator`. So with the mock stopped every scenario reports the same wrong thing — hence the health probe that hard-gates the runner, and why the genuine transport scenario bypasses the proxy for an unbound port.
- **The mock must send `Vary: x-mock-scenario`.** Scenario selection is a request header on a fixed URL, so without it the browser's HTTP cache replays one scenario's response for the next.
- **Timeout and transport failures are indistinguishable by classification** — both are status-less `backoff`. Separate them on the message.
- **The sponsoring query keys carry no base URL** while the SDK's own config cache is keyed by it, so switching target must drop the React Query cache. Clear the ONE live client on a fingerprint change — do not swap the `client` prop: React Query binds each observer to its client at mount and never re-binds, so a swap is a no-op for every mounted hook and also tears down the outgoing client's focus/online subscriptions. The event log lives above the client so it survives the clear.
- **Lab state drives the SDK only when the lab ships.** `LabContext` switches on `LAB_ENABLED` in one place; a build without the lab reads `VITE_SPONSORING_API_BASE_URL`. Routing the Showcase through the lab's resolver would hardwire every deployment to `${origin}/__sponsor`, a path that exists only behind the Vite dev proxy.
- **Soroban cannot be mocked.** The mock serves no Soroban RPC, so with mock Horizon on, reads are fake and writes would be real — `resolved.blocksSpokeWrites` disables the trustline action rather than letting a `changeTrust` built on mock state reach mainnet.
- **There are two independent Horizon clients.** The lab repoints the SDK's; it deliberately leaves the wallet layer's alone, because `SodaxWalletProvider` freezes its config on first render and remounting it would disconnect the wallet mid-session.
- **`setHeaders` cannot unset a header** — clear a sticky scenario by writing an empty value, which the mock reads as "no scenario".
- **`.env` goes in the app root, not `src/`.** Vite's `envDir` is the project root, so a `src/.env` is silently inert.
- **`example.env` holds placeholders only.** `mock-dev-key` is the mock's non-secret default; a real key belongs in your own untracked `.env`.
- **Base URLs are compared for equality, so normalize user input.** `isRealMainnet` (and the `fingerprint` that drops the React Query cache) is a plain `===` against `DEFAULT_SPONSORING_API_ENDPOINT`. The SDK trims trailing slashes before appending `/sponsorships/stellar/…`, so a pasted `https://api.sodax.com/v1/` reaches **real mainnet** — `labConfig`'s `normalizeBaseUrl` therefore trims the custom target and the env var before narrowing, or the REAL MAINNET banner silently never renders for a mainnet target. The version prefix itself belongs to the deployment (`…/v1` on the gateway, bare origin locally); the mock answers either shape.
- **When `pnpm check:sponsoring-contract` reports drift**, the mock catalog and `lab/scenarios.ts` are downstream of the fix — the mock's codes come from `SPONSORING_API_ERROR_CODES`, which that gate already diffs against the spec.

## Scripts

```bash
pnpm dev               # vite dev server on :3003
pnpm mock-sponsoring   # the offline double on :9011
pnpm build             # production bundle
pnpm preview           # serve the built bundle (verify hash routing here)
pnpm test              # node --test: the mock's pure builders + its route table
pnpm checkTs           # tsc --noEmit
pnpm lint / pnpm pretty
```

Scenario expectations in `lab/scenarios.ts` are **hand-declared**, deliberately duplicating the status→action table in `packages/sdk/src/sponsoring/errors.ts`. Deriving them from `classifySponsorError` would make the assertion vacuous. Coverage is guarded at compile time (`as const satisfies`) and mock/lab agreement is proved at runtime by the catalog-drift banner.
