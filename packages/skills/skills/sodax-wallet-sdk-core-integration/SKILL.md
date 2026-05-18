---
name: sodax-wallet-sdk-core-integration
description: Build NEW code with `@sodax/wallet-sdk-core` — the low-level multi-chain wallet layer (one provider class per chain family across 9 chain types: EVM, Solana, Sui, Bitcoin, Stellar, ICON, Injective, NEAR, Stacks). Each class accepts either a private-key config (Node scripts, CI, bots, indexers) or a browser-extension config (custom non-React browser flows) and signs + broadcasts transactions. Use whenever a backend, script, test, or non-React browser flow needs to instantiate a wallet provider directly — `EvmWalletProvider`, `SolanaWalletProvider`, etc. Triggers on "instantiate EvmWalletProvider", "sign a tx from a Node script", "wallet provider for backend", "private-key signing", "wallet-sdk-core setup", any `*WalletProvider` class name. For React dapps prefer `sodax-wallet-sdk-react-integration` instead — most React consumers never touch this package directly and get a typed `IXxxWalletProvider` via `useWalletProvider(...)`.
---

# When to use this skill

Direct usage of `@sodax/wallet-sdk-core` is the right choice for:

- Backend / Node scripts (CI tests, indexers, bots, server APIs).
- Custom browser flows that don't use React.
- Tests that need to sign with a deterministic key.

For React consumers → use `sodax-wallet-sdk-react-integration` (they get the typed wallet provider via `useWalletProvider(...)` and pass it to `@sodax/sdk` calls).

For upgrades from older versions → use `sodax-wallet-sdk-core-migration` (but note: v1 → v2 changes are **additive** — all v1 surface still exists, mostly just a deep-import → barrel-import cleanup).

# Workflow

1. Read [`../../knowledge/wallet-sdk-core/integration/ai-rules.md`](../../knowledge/wallet-sdk-core/integration/ai-rules.md) — DO / DON'T + workflow + stop conditions.
2. Read [`../../knowledge/wallet-sdk-core/integration/architecture.md`](../../knowledge/wallet-sdk-core/integration/architecture.md) — mental model: `BaseWalletProvider`, dual-config discriminants (`{ type: 'PRIVATE_KEY', … }` vs `{ type: 'BROWSER_EXTENSION', … }`), shallow `defaults` merge, library-exports.
3. Read [`../../knowledge/wallet-sdk-core/integration/quickstart.md`](../../knowledge/wallet-sdk-core/integration/quickstart.md) — copy-paste minimal example for the chain you need.
4. For your chain, read [`../../knowledge/wallet-sdk-core/integration/features/`](../../knowledge/wallet-sdk-core/integration/features/) — per-chain config table + methods + gotchas (one file per chain family).
5. Task-specific recipes → [`../../knowledge/wallet-sdk-core/integration/recipes/`](../../knowledge/wallet-sdk-core/integration/recipes/) — `setup-private-key.md`, `setup-browser-extension.md`, `sign-and-broadcast.md`, `defaults-and-overrides.md`, `library-exports.md`, `bridge-to-sdk.md` (pass provider to `@sodax/sdk`).
6. Lookups → [`../../knowledge/wallet-sdk-core/integration/reference/`](../../knowledge/wallet-sdk-core/integration/reference/) — public API, provider classes, interfaces (`IXxxWalletProvider`), chain support, glossary.

# Conventions to follow

- **Dual-config discriminant.** Every chain's provider config has a `type` discriminator: `'PRIVATE_KEY'` (Node / scripts) or `'BROWSER_EXTENSION'` (consumer dApps). Pick one — don't merge them.
- **`defaults` is a shallow merge.** Each provider accepts a `defaults` field for per-method overrides (e.g. `waitForTransactionReceipt`, `gasPrice`). The merge into the per-call options is **shallow**, not deep. Top-level keys overwrite wholesale.
- **Use barrel imports**, not deep imports. Import classes from `@sodax/wallet-sdk-core`, not from `@sodax/wallet-sdk-core/wallet-providers/<chain>.ts`.
- **Re-import chain SDK types from the barrel.** `@sodax/wallet-sdk-core` re-exports the types you need (e.g. `WalletClient` from viem, `SuiClient` from `@mysten/sui`). Don't add the underlying SDK as a direct dep — risks version skew.
- **`IXxxWalletProvider` is the interface to pass into `@sodax/sdk`.** When bridging to the SDK, narrow with `useWalletProvider({ xChainId: ChainKeys.X })` (React) or just construct the provider directly and pass it in the SDK call payload (`{ raw: false, walletProvider }`).

# Top traps to avoid

1. **Mixing the two config variants.** `PRIVATE_KEY` and `BROWSER_EXTENSION` are mutually exclusive. Each chain's `*WalletProviderConfig` is a discriminated union — TypeScript catches mixing, but only if you don't use `as`.
2. **Adding viem / `@mysten/sui` / `@solana/web3.js` as a direct dep** when the type was importable from `@sodax/wallet-sdk-core`. See `integration/recipes/library-exports.md`.
3. **Deep-importing `@sodax/wallet-sdk-core/wallet-providers/EvmWalletProvider`**. v1's flat layout is gone; use barrel imports.
4. **Expecting `defaults` to deep-merge.** It doesn't — top-level keys overwrite wholesale.
5. **Trying to extend `BaseWalletProvider` directly** in consumer code. That's a maintainer-only path — write a thin wrapper over an existing provider instead.

# Verification

```bash
pnpm tsc --noEmit   # must exit clean
```

If errors mention `@sodax/wallet-sdk-core`, look up the symbol in `integration/reference/`. If the symbol isn't there, stop and ask the user — don't invent classes.

# Related skills

- `sodax-wallet-sdk-core-migration` — additive v1 → v2 upgrade (mostly deep-import → barrel cleanup).
- `sodax-sdk-integration` — pass the constructed provider into SDK calls (`{ raw: false, walletProvider }`).
- `sodax-wallet-sdk-react-integration` — for React dapps; this skill is only relevant if NOT using React.
