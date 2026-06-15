---
name: add-feature
description: 'Use when adding a NEW feature/service to the @sodax/sdk core — a new cross-chain DeFi capability or flow with its own <Feature>Service — as opposed to a token (add-token), a chain (add-chain), or a wallet (add-wallet-provider). The feature LOGIC is bespoke: design it from the nearest existing feature service. This skill nails the easy-to-miss cross-cutting WIRING. Triggers on "add a feature", "add a new service", "new SDK flow", "add a <X>Service to the sdk", "wire a feature into Sodax", "expose a new operation in the SDK". The optional React hook layer is packages/dapp-kit.'
---

# Adding a Feature to the SODAX SDK

> A feature's domain logic is **bespoke** — design it by starting from the nearest existing feature
> service (`swap`, `moneyMarket`, `bridge`, `staking`, `dex`, `migration`, `partner`, `recovery`).
> This skill covers the **cross-cutting wiring** that is easy to miss, not the logic. Verify each
> slot against current `src/`.

## Where a feature lives

`packages/sdk/src/<feature>/` — a self-contained module. Mirror the nearest sibling:
- `<Feature>Service.ts` — the service class. Constructor dependency injection: take `{ hubProvider, config, spoke, … }` (match what the nearest feature injects); never import singletons.
- `<Feature>Types.ts` — request/response and public contract types. Keep backend payloads JSON-safe (string amounts).
- `errors.ts` — feature-scoped errors: `createInvariant('<feature>')` plus the feature's error-code types `Extract<>`'d from the shared `SodaxErrorCode` (`src/errors/codes.ts`); add new codes there if the feature needs them.
- `index.ts` — barrel.
- `<Feature>Service.test.ts` — unit tests beside the code.
- sub-services / `math-utils` / helpers as needed (cf. `moneyMarket/`).

## Wiring (the easy-to-miss part)

1. **Facade** — `src/shared/entities/Sodax.ts`: `import { <Feature>Service } from '../../<feature>/<Feature>Service.js'`; add a `public readonly <feature>: <Feature>Service;` field; construct it in the ctor — `this.<feature> = new <Feature>Service({ hubProvider: this.hubProvider, config: this.config, spoke: this.spoke })` (match the nearest feature's deps).
2. **Public surface** — `src/index.ts`: add `export * from './<feature>/index.js';` so the feature's public types ship.
3. **Chain routing** — never construct chain providers. Route chain-specific work through `this.spoke.getSpokeService(chainKey)`. Public operations that can fail return `Result<T>` and fail via `SodaxError` — see `packages/sdk/AGENTS.md` → "Service Pattern" and "Errors And Results".

## React hook layer (only if it is a product/UI flow)

If consumers call it from React, add a `packages/dapp-kit/src/hooks/<feature>/` hook (a React-Query wrapper over the service), following the existing per-feature hook dirs (`bridge`, `mm`, `dex`, …) and `dapp-kit/AGENTS.md`. Node/backend consumers use the SDK service directly — not every feature needs a hook.

## Tests & docs
- `<Feature>Service.test.ts` for core flows, invariants, and edge cases; add an `e2e-tests/` entry if the flow is cross-chain.
- Update `packages/sdk/docs/` and the consumer skills in `packages/skills` **only when public SDK behavior, imports, signatures, or examples changed** — then run `pnpm check:ai`.

## Verify
- `cd packages/sdk && pnpm test && pnpm checkTs` (and `pnpm test:e2e` if you added a cross-chain e2e).
- Confirm the facade field + ctor wiring in `Sodax.ts` and the barrel export in `src/index.ts` — a feature that compiles but is not wired into the facade is unreachable.
