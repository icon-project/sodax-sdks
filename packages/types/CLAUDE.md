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
