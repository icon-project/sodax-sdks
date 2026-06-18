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

## Root vs sub-path exports

Only **two** entry points are exported via [`package.json` `exports`](package.json):

- `.` — the root barrel ([`src/index.ts`](src/index.ts)) re-exports everything. This is the normal import path: `import { ChainKeys, type IEvmWalletProvider } from '@sodax/types'`.
- `./dex` — dedicated entry for DEX types: `import { … } from '@sodax/types/dex'`.

There are **no per-chain sub-path exports**. New chain types are added under the appropriate subdirectory, re-exported through that subdirectory's `index.ts`, and flow out through the root barrel automatically.

## Swap supported tokens (staging vs production)

Swap tokens live in [`src/swap/swap.ts`](src/swap/swap.ts) as two separate per-chain lists, both `Record<SpokeChainKey, readonly XToken[]>`:

- `swapSupportedTokens` — **production** solver tokens (also wired into `swapsConfig.supportedTokens`).
- `stagingSwapSupportedTokens` — tokens supported **only** in the **staging** solver environment. The staging solver supports **all** tokens: every production token plus these.

The two lists are **disjoint per chain** — a token is stored in exactly one of them. `isSwapSupportedToken(chainId, token)` validates against the **union** of both (it is upon the caller to target the correct environment; the SDK does not gate on env). Accessors: `getSupportedSolverTokens` (production list only), `getStagingSolverTokens` (production + staging-only, i.e. the full staging set). Invariants are enforced by [`src/chains/tokens-dedup.test.ts`](src/chains/tokens-dedup.test.ts) (no intra-list dups) and [`src/swap/swap.test.ts`](src/swap/swap.test.ts) (disjointness, staging-superset accessor, union validation). The staging-only entries were derived by diffing the lists against the production solver oracle (`https://sodax-solver.iconblockchain.xyz/oracle`). Last re-synced 2026-06-16: tokens now present in the oracle were promoted to production (Base `SODA`, Optimism `bnUSD`, and the 8 Solana xStocks `CRCLx`/`TSLAx`/`SPYx`/`NVDAx`/`QQQx`/`MSTRx`/`COINx`/`GOOGLx`). Three items remain pending solver-team confirmation (#193) and were intentionally **not** changed: (1) ICON `ICX`/`wICX`/`bnUSD` — the oracle returns no ICON entries at all (likely out-of-scope rather than staging); (2) Sonic `sodaWBTC`/`IbnUSD` — absent from the oracle but pulled into production via the `Object.values(SodaTokens)` spread; (3) Arbitrum `SODA` — moved to **production**; the SDK address `0x5bDa87…dc6F5` is the correct current token, but **both** solver oracles still list an **older** deployment (`0x6958…b3b92F`), so production fills depend on the solver updating its oracle (do **not** change the SDK address). Note non-EVM addresses differ in format between oracle and SDK (Sui zero-padding, Bitcoin hex, Stacks `::token` suffix), so oracle membership cannot be checked by naive string match for those chains. Use the repo-internal `add-swap-token` Claude skill (`.claude/skills/add-swap-token`) to add entries — it always asks for the target environment.

To **re-verify** the lists against the live oracles and **regenerate the public docs**, run [`scripts/sync-swap-tokens-docs.sh`](../../scripts/sync-swap-tokens-docs.sh) (repo root). It curls both oracles (staging `https://sodax-solver-staging.iconblockchain.xyz/oracle`, production `https://sodax-solver.iconblockchain.xyz/oracle`; both overridable via `STAGING_ORACLE_URL`/`PROD_ORACLE_URL`), reads these two lists via a `tsx` helper, joins them by `RelayChainIdMap` chainId + case-insensitive address, prints a sync report (exits non-zero on **EVM** drift — non-EVM chains are listed but not failed on, per the format caveat above; pass `--no-fail` to only warn, `--check-only` to skip writing docs), and writes a combined per-chain GitBook table (one row per token, marked ✅ production / 🚧 staging-only) to `docs/swap-supported-tokens.md`. Known accepted drift (Sonic `sodaWBTC`/`IbnUSD`, Arbitrum `SODA`, and any staging-only tokens the staging oracle has not yet picked up) will show as missing until the solver oracles catch up.

## Build

Built with `tsc` (other workspace packages bundle with tsup — this one doesn't bundle). ESM only (`"type": "module"`). Output: `dist/` with `.js` + `.d.ts` files.

Relative imports inside source must use `.js` extensions (see [`src/index.ts`](src/index.ts) for the pattern).

## Rules

- **Zero runtime dependencies.** `package.json` has no `dependencies` block — only devDependencies. Never add a runtime dependency; all types must be self-contained.
- **No re-exporting external types.** Do not import or re-export types from third-party packages (e.g. `viem`, `ethers`, `@solana/web3.js`). Define equivalent types locally so consumers don't pick up transitive type deps.
- **Prefer `import type`** wherever possible — this package should produce minimal runtime JavaScript (effectively just re-exports plus a small number of intentional runtime values, e.g. `CONFIG_VERSION`, chain key constants, Stacks enums).
- **Add new types in their subdirectory**, then re-export through that subdirectory's `index.ts`. The root `src/index.ts` already re-exports each subdirectory's barrel, so nothing more is needed for the type to be importable from `@sodax/types`.
- **`CONFIG_VERSION` bump convention** ([`src/index.ts`](src/index.ts)): bump this on any types change inside a `release/sdk` branch. Consumers (notably `@sodax/sdk`'s `ConfigService`) rely on it to detect config-schema drift between SDK releases.
- **All wallet provider interfaces extend `WalletAddressProvider`** from `common/`.
- **No `any`.** Use `unknown` where the type cannot be known statically.
