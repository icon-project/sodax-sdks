# packages/sdk

Core SODAX SDK. Entry point: `Sodax` in `src/shared/entities/Sodax.ts`.

This package must work without React, wallet-sdk-react, or dapp-kit. Backend partners, scripts, and bots can use it directly with wallet-provider implementations.

Consumer-facing AI material lives in `packages/skills`; keep this file focused on maintaining the SDK source itself.

## Architecture

- `Sodax` is the facade. It constructs feature services and shared services from one config object.
- Sonic is the hub chain. Cross-chain operations route through hub contracts and per-chain-family spoke services.
- `ConfigService` loads dynamic config from the backend and falls back to packaged defaults from `@sodax/types`.
- `SpokeService` is the runtime router for chain-family services. Feature code should call `this.spoke.getSpokeService(chainKey)` instead of constructing chain-specific providers directly.
- Wallet-provider interfaces come from `@sodax/types` via the SDK public barrel. Implementations live outside this package.

## Source Map

```text
src/
├── index.ts                 # public barrel, including @sodax/types re-exports
├── shared/                  # facade, providers, config, spoke routing, guards, utils
├── swap/                    # intent-based swaps and solver integration
├── moneyMarket/             # lending/borrowing flows and math helpers
├── bridge/                  # vault-backed cross-chain token transfers
├── staking/                 # SODA staking and unstaking flows
├── dex/                     # concentrated liquidity and DEX asset operations
├── leverageYield/           # leveraged-yield ERC-4626 vaults on the Sonic hub
├── migration/               # legacy ecosystem token migration flows
├── partner/                 # partner fee operations
├── recovery/                # hub-wallet asset recovery
├── backendApi/              # backend API client
└── e2e-tests/               # SDK-level E2E tests
```

Detailed feature docs live in `docs/`. Read the relevant feature doc before changing public behavior.

### Links In `docs/` And `README.md`

`sodax-document` mirrors most of `docs/` plus `README.md` into GitBook (docs.sodax.com) and **moves and renames them** on the way — the feature docs (`SWAPS.md`, `MONEY_MARKET.md`, `BRIDGE.md`, `STAKING.md`, `MIGRATION.md`, `LEVERAGE_YIELD*.md`, `DEX.md`) land in `functional-modules/` lowercased, `BACKEND_API.md` / `INTENT_RELAY_API.md` / `SWAPS_API.md` in `tooling-modules/`, `BITCOIN_INTEGRATION.md` under `how-to/`, and only the how-to set (`CONFIGURE_SDK`, `ESTIMATE_GAS`, `HOW_TO_MAKE_A_SWAP`, `MONETIZE_SDK`, `WALLET_PROVIDERS`, `STELLAR_TRUSTLINE`, `RELAYER_API_ENDPOINTS`, `SOLVER_API_ENDPOINTS`, `LOGGING`, `ARCHITECTURE`) keeps its directory and filenames. `../CHAIN_ID_MIGRATION.md` is mirrored one level up at `developers/packages/sdk/CHAIN_ID_MIGRATION.md` **specifically** so `ARCHITECTURE.md`'s `../CHAIN_ID_MIGRATION.md` link stays relative — don't move it. `scripts/gitbook-sync-map.json` holds the full mapping. `AGENTS.md` / `CLAUDE.md` and the repo-root `packages/*_FEATURE_MIGRATION_SUMMARY.md` files are contributor-facing and deliberately unmirrored — link to those with absolute `blob/main/…` URLs only.

So a relative link may only point at a doc mirrored into the same directory under the same name — in practice how-to → how-to, e.g. `HOW_TO_MAKE_A_SWAP.md` → `./CONFIGURE_SDK.md`. Everything else, including the reverse direction (`SWAPS.md` → `CONFIGURE_SDK.md`), needs an absolute `https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/<FILE>.md` URL (`/tree/main/` for a directory). Relative links that break here render as 404s on docs.sodax.com and get rewritten to dead `sodax-document` URLs on every sync. Run `pnpm check:doc-links`.

## Service Pattern

Feature modules use service classes with constructor dependency injection.

- Inject shared dependencies instead of importing singletons.
- Public operations that can fail should return `Result<T>` instead of throwing.
- Treat input validation, guards, amount/decimal and address handling, and signing boundaries as correctness-critical: this is financial code, so don't weaken or bypass them, and cover changes with tests.
- Preserve chain-key-first routing: request payload chain keys drive TypeScript narrowing and runtime spoke selection.
- Use source-derived config through `ConfigService`; do not copy chain/token lists into code or agent docs.

## Errors And Results

The SDK uses `SodaxError` plus `Result<T>` for feature-level failures.

- Discriminate on `error.feature` and `error.code`.
- Use `isSodaxError(error)` for cross-bundle checks.
- Attach operation detail to `error.context` rather than adding new code variants for every method.
- Convert bigint values before JSON serialization. `SodaxError.toJSON()` already handles bigint values in context.
- Keep per-method error unions narrow when the surrounding module already follows that pattern.

When wrapping lower-level work:

```ts
const sub = await this.subOperation();
if (!sub.ok) return sub;

try {
  // feature operation
} catch (error) {
  return {
    ok: false,
    error: new SodaxError('EXECUTION_FAILED', 'Operation failed', {
      feature: 'moneyMarket',
      cause: error,
      context: { action: 'supply', phase: 'execution' },
    }),
  };
}
```

## Adding Or Changing Features

1. Start from the existing feature service nearest to the new behavior.
2. Add public types under the feature or `shared/types/` only when they are part of the SDK contract.
3. Route chain-specific behavior through `SpokeService` or an existing shared helper.
4. Keep backend request/response types JSON-safe; use strings for serialized numeric amounts.
5. Add or update unit tests beside the changed code.
6. Update `docs/` and `packages/skills` only when public SDK behavior, imports, signatures, or examples changed.

To scaffold a **whole new feature/service**, use the `add-feature` skill (`.claude/skills/add-feature/`) — it covers the `Sodax` facade wiring, the `src/index.ts` barrel, and the error/dapp-kit footprint.

To **add a token**, use the `add-token` skill (`.claude/skills/add-token/`); token config lives in `@sodax/types`, not here.

To **add a chain** (new spoke), use the `add-chain` skill (`.claude/skills/add-chain/`); it covers the spoke service + router here plus the cross-package steps in `@sodax/types` and the wallet packages.

## Logging

SDK diagnostics go through `SodaxLogger`, resolved from `new Sodax({ logger })`.

- Feature services should use `this.config.logger`.
- Avoid adding new direct `console.*` calls in service code.
- Keep runtime logging separate from backend config data.

## Analytics

Separate from logging: the SDK can emit **structured, opt-in user-action events** to a consumer-supplied tracker. Unlike `logger`, analytics is **off by default** and events are structured (`feature` + `action` + `phase` + `level` + `data`) rather than free-form messages.

- **Enable:** `new Sodax({ analytics: { tracker, level?, features? } })` where `tracker` is a `(event) => void` callback (e.g. `(event) => amplitude.track(event.action, event.data)`). The `analytics` option lives on `SodaxOptions` (in `@sodax/types`) next to `logger` and `fee` — client-side runtime, never on the backend-fetched `SodaxConfig`. Omit it (or pass `false`) to stay disabled.
- **Types** live in `@sodax/types` (`shared/analytics.ts`): `AnalyticsTracker`, `AnalyticsEvent`, `AnalyticsConfig`, `AnalyticsFeatures`/`AnalyticsFeatureScope`, `AnalyticsOption = AnalyticsConfig | false`. The `feature` field is `SodaxFeature` (sourced from `@sodax/types`, re-exported from `errors/codes.ts`) so analytics events and `SodaxError`s share one feature taxonomy.
- **Feature/action scoping is an allowlist.** `features` omitted → track everything. Otherwise only listed features emit: `{ swap: true, moneyMarket: { actions: ['supply','borrow'] } }` (a feature omitted from the object is OFF), or the array shorthand `['swap','moneyMarket']` (each fully tracked). `resolveAnalytics` normalizes this once into a `Map<feature, true | Set<action>>` (`null` = no scoping).
- **Resolution** lives in `shared/analytics.ts` (`resolveAnalytics`, `noopAnalytics`, `ResolvedAnalytics`), defaulting to the no-op (disabled) emitter. The resolved emitter is held on `ConfigService` (`config.analytics`, `public readonly`) **outside** the swappable `SodaxConfig`, exactly like `config.logger` and `config.fee`.
- **Emit gating** — `emit(feature, action, phase, build?, level?)` takes a **lazy thunk** invoked only when the event passes the enabled / feature+action allowlist / level gate, so payloads are never built when analytics is off or gated out. A throwing tracker is swallowed (fire-and-forget); analytics never breaks a feature flow.
- **`trackResult` is the canonical instrumentation pattern.** Each public action method wraps its own body in an inline closure: `return this.config.analytics.trackResult('<feature>', '<action>', async () => { …action body… }, { start?, success?, failure? })`. It emits `start`, runs the body, then `success`/`failure` from the returned `Result`, returning it unchanged — one boundary call covers every internal return. Keep the body in the action method (no separate `*Impl` helper); any cheap pre-computation can sit above the `trackResult` call, but the work that can fail belongs inside the closure.
- **Coverage — all features.** Every user-action flow is instrumented (action mirrors `context.action`): swap, moneyMarket (`supply`/`borrow`/`withdraw`/`repay`), bridge, staking, migration, dex, partner, recovery, leverageYield. Each `trackResult` call carries `data` builders: `start` emits the action inputs (chain keys, addresses, token(s), amount/ids — only fields present on that action's param type), `success` emits the public on-chain identifiers (tx hashes, intent/position ids), and `failure` emits `{ code: error.code }`. Builders reference the method parameter (`_params.params.<field>`) since they are siblings of the closure, and run lazily — never invoked when analytics is off or gated out. Add new fields the same way; keep amounts as `bigint` (the consumer tracker serializes).

## Build And Tests

```bash
cd packages/sdk
pnpm test
pnpm test:e2e
pnpm coverage
pnpm build
pnpm checkTs
```

The package builds dual ESM/CJS output with `tsup`. Relative imports in source use `.js` extensions.
