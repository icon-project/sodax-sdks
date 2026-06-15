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
├── migration/               # legacy ecosystem token migration flows
├── partner/                 # partner fee operations
├── recovery/                # hub-wallet asset recovery
├── backendApi/              # backend API client
└── e2e-tests/               # SDK-level E2E tests
```

Detailed feature docs live in `docs/`. Read the relevant feature doc before changing public behavior.

## Service Pattern

Feature modules use service classes with constructor dependency injection.

- Inject shared dependencies instead of importing singletons.
- Public operations that can fail should return `Result<T>` instead of throwing.
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

To **add a token**, use the `add-token` skill (`.claude/skills/add-token/`); token config lives in `@sodax/types`, not here.

## Logging

SDK diagnostics go through `SodaxLogger`, resolved from `new Sodax({ logger })`.

- Feature services should use `this.config.logger`.
- Avoid adding new direct `console.*` calls in service code.
- Keep runtime logging separate from backend config data.

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
