# packages/types

Shared TypeScript contract layer for the SODAX monorepo. Defines chain IDs and configs, the dynamic-config shape, backend API DTOs, per-feature parameter/response shapes, wallet provider interfaces, and shared utility types.

This is the lowest layer in the dependency graph — every other package imports from here:
- `@sodax/sdk` imports and re-exports it
- `@sodax/wallet-sdk-core` and `@sodax/wallet-sdk-react` import from it
- `@sodax/dapp-kit` gets it transitively via `@sodax/sdk`

## Structure

Subdirectory-per-domain. Each subdirectory has its own `index.ts` barrel and is re-exported from the root barrel.

```
src/
├── index.ts            # Root barrel — re-exports every subdirectory
├── chains/             # Chain IDs, chain keys, chain configs
├── shared/             # Shared types used across multiple domains
├── common/             # Base types: Hex, Hash, Address, WalletAddressProvider
├── sodax-config/       # Dynamic SDK config shape (fetched from backend)
├── backend/            # Backend API request/response DTOs
├── utils/              # Helper type utilities
├── wallet/             # Generic wallet provider interfaces
│
├── evm/                # EVM wallet provider interface + raw tx/receipt types
├── solana/             # Solana wallet provider interface + tx/instruction types
├── sui/                # Sui wallet provider interface + tx/coin types
├── bitcoin/            # Bitcoin wallet provider interface + UTXO types
├── stellar/            # Stellar wallet provider interface + raw receipt types
├── injective/          # Injective wallet provider interface + execute result
├── icon/               # ICON wallet provider interface + call tx / result
├── near/               # NEAR wallet provider interface + raw tx types
├── stacks/             # Stacks wallet provider interface + Clarity / post-condition types
│
├── swap/               # Swap (intent-based solver) param/response shapes
├── moneyMarket/        # Money market param/response shapes
└── dex/                # DEX (concentrated liquidity / AMM) shapes — has dedicated sub-path export
```

## Client-side runtime options & cross-cutting tags (`shared/`)

Two `Sodax` constructor options are **client-side runtime sinks**, deliberately kept OUT of the backend-fetched data contract and instead added to `SodaxOptionalConfig` / `SodaxOptions` (`sodax-config/sodax-config.ts`) so the dynamic-config swap never overwrites them:

- `logger` ([`shared/logger.ts`](src/shared/logger.ts)) — `SodaxLogger` / `SodaxLoggerOption`. Developer diagnostics, **on by default** (`console`).
- `analytics` ([`shared/analytics.ts`](src/shared/analytics.ts)) — `AnalyticsTracker` (a `(event) => void` callback), `AnalyticsEvent` (`feature` + `action` + `phase` + `level` + `data`), `AnalyticsConfig` (`tracker` + optional `level` + `features` allowlist), `AnalyticsFeatures`/`AnalyticsFeatureScope` (the allowlist: `true` | `{ actions }` per feature, or an array shorthand; omitting `features` tracks everything), `AnalyticsOption = AnalyticsConfig | false`. Product user-action tracking, **off by default**. The SDK-side resolution + emit gating is implemented in `@sodax/sdk` (`shared/analytics.ts`), mirroring `resolveLogger`.

`SodaxFeature` ([`shared/features.ts`](src/shared/features.ts)) is the canonical list of SDK features (`swap`, `moneyMarket`, …, `leverageYield`). It lives here — the lowest layer — because both the error layer (`SodaxError.feature` in `@sodax/sdk`) and analytics depend on it; `@sodax/sdk`'s `errors/codes.ts` re-exports it (and keeps the runtime `SODAX_FEATURES` list). Add a new feature here, in one place.

## Root vs sub-path exports

Only **two** entry points are exported via [`package.json` `exports`](package.json):

- `.` — the root barrel ([`src/index.ts`](src/index.ts)) re-exports everything. This is the normal import path: `import { ChainKeys, type IEvmWalletProvider } from '@sodax/types'`.
- `./dex` — dedicated entry for DEX types: `import { … } from '@sodax/types/dex'`.

There are **no per-chain sub-path exports**. New chain types are added under the appropriate subdirectory, re-exported through that subdirectory's `index.ts`, and flow out through the root barrel automatically.

## Swap supported tokens (staging vs production)

Swap tokens live in [`src/swap/swap.ts`](src/swap/swap.ts) as two per-chain `Record<SpokeChainKey, readonly XToken[]>` lists:

- `swapSupportedTokens` — **production** solver tokens (also wired into `swapsConfig.supportedTokens`).
- `stagingSwapSupportedTokens` — tokens supported **only** in the **staging** solver environment.

The two lists are **disjoint per chain** (a token lives in exactly one). The staging solver supports the union — every production token plus the staging-only set. Accessors: `getSupportedSolverTokens` returns the production list only; `getStagingSolverTokens` returns the full staging set (production + staging-only). `isSwapSupportedToken(chainId, token)` validates against the union and does **not** gate on environment — the caller targets the correct one. Invariants (intra-list dedup, disjointness, staging-superset accessor, union validation) are enforced by [`src/chains/tokens-dedup.test.ts`](src/chains/tokens-dedup.test.ts) and [`src/swap/swap.test.ts`](src/swap/swap.test.ts). Add or move entries via the `add-token` skill (see Rules) and always confirm the target environment first.

## Chain logos

Each `baseChainInfo` entry carries a `logo` URL (default chain logo). The binary
files are **not** in this package — they live in [`packages/assets`](../assets/AGENTS.md)
and are served via `raw.githubusercontent.com`. `CHAIN_LOGO_BASE_URL` (exported
from [`src/chains/chains.ts`](src/chains/chains.ts)) is the directory base, and
each logo URL is `${CHAIN_LOGO_BASE_URL}/<chainKey>.png` — so the filename in
`packages/assets/chain/` must equal the `ChainKeys` value. Adding a chain logo:
drop `<chainKey>.png` in `packages/assets/chain/` and set the new entry's `logo`
to `chainLogo(ChainKeys.<NAME>)`. Invariants are covered by
[`src/chains/chains-logo.test.ts`](src/chains/chains-logo.test.ts). Consumers
(demo, web app) must read `baseChainInfo[key].logo`, not hardcode icon paths.

## Token logos

Token logos mirror chain logos but resolve by symbol instead of a stored field.
The binaries live in [`packages/assets`](../assets/AGENTS.md) under `token/` and
are served via `raw.githubusercontent.com`. `TOKEN_LOGO_BASE_URL` (exported from
[`src/chains/tokens.ts`](src/chains/tokens.ts)) is the directory base, and
`tokenLogo(symbol)` returns `${TOKEN_LOGO_BASE_URL}/${tokenLogoSlug(symbol)}.png`.
`tokenLogoSlug` lowercases the symbol and collapses non-alphanumeric runs to `-`
(so `bnUSD (legacy)` → `bnusd-legacy`), keeping filenames URL- and path-safe.
Adding a token logo: drop `<tokenLogoSlug(symbol)>.png` in `packages/assets/token/`
— no per-token config edit is needed. Invariants (URL shape, slug safety, no
slug collisions across symbols) are covered by
[`src/chains/tokens-logo.test.ts`](src/chains/tokens-logo.test.ts). Consumers
must resolve icons with `tokenLogo(token.symbol)`, not hardcode icon paths.

## Build

Built with `tsc` (other workspace packages bundle with tsup — this one doesn't bundle). ESM only (`"type": "module"`). Output: `dist/` with `.js` + `.d.ts` files.

`build` is `rm -rf dist && tsc`, and the `rm -rf` is load-bearing: plain `tsc` never deletes an output whose source has been removed or renamed, so a stale `.d.ts` survives every later build and gets packed into `pnpm pack:local` tarballs — where a consumer reading `node_modules` cannot distinguish a stale emit from a real export. The tsup-built packages get this from `clean: true` in their `tsup.config.ts`; this one has no bundler to do it. Published releases were never affected (CI publishes from a fresh checkout with no turbo remote cache), but local builds and local packs were.

Relative imports inside source must use `.js` extensions (see [`src/index.ts`](src/index.ts) for the pattern).

## Rules

- **Zero runtime dependencies.** `package.json` has no `dependencies` block — only devDependencies. Never add a runtime dependency; all types must be self-contained.
- **No re-exporting external types.** Do not import or re-export types from third-party packages (e.g. `viem`, `ethers`, `@solana/web3.js`). Define equivalent types locally so consumers don't pick up transitive type deps.
- **EVM addresses must survive `isAddress`.** A mixed-case EVM address has to carry a valid EIP-55 checksum; all-lowercase is also valid and is what hub-side fields (`hubAsset`, `vault`) use. viem rejects a bad checksum while encoding calldata, so inside a `multicall` one typo fails the whole batch and every balance in it reads zero. Enforced by [`src/chains/config-address-checksum.test.ts`](src/chains/config-address-checksum.test.ts), which walks the barrel — viem is a devDependency there, so the zero-runtime-dependency rule is unaffected. **Never re-case a non-EVM identifier** (Solana base58, Sui, Stacks, Icon, Stellar) to satisfy anything; that changes the address.
- **Prefer `import type`** wherever possible — this package should produce minimal runtime JavaScript (effectively just re-exports plus a small number of intentional runtime values, e.g. `CONFIG_VERSION`, chain key constants, Stacks enums).
- **Add new types in their subdirectory**, then re-export through that subdirectory's `index.ts`. The root `src/index.ts` already re-exports each subdirectory's barrel, so nothing more is needed for the type to be importable from `@sodax/types`.
- **Adding a token?** Use the `add-token` skill (`.claude/skills/add-token/`) — it has the verified end-to-end procedure (which chain map and feature lists to touch, the payload→`XToken` field mapping, and what is auto-handled). Do not wire token config ad hoc. Docs Drift requires a mapped feature page (`SWAPS.md` / `MONEY_MARKET.md`) or `packages/types/README.md` alongside `src/` changes.
- **Adding a chain?** Use the `add-chain` skill (`.claude/skills/add-chain/`) — it orchestrates the cross-package footprint that starts here (chain key, config, types, wallet interface) and continues into the sdk spoke and the wallet packages.
- **`CONFIG_VERSION` bump convention** ([`src/index.ts`](src/index.ts)): bump this on any types change inside a `release` branch. Consumers (notably `@sodax/sdk`'s `ConfigService`) rely on it to detect config-schema drift between SDK releases.
- **All wallet provider interfaces extend `WalletAddressProvider`** from `common/`.
- **No `any`.** Use `unknown` where the type cannot be known statically.
