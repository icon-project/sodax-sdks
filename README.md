[![Packages CI](https://github.com/icon-project/sodax-sdks/actions/workflows/packages-ci.yml/badge.svg)](https://github.com/icon-project/sodax-sdks/actions/workflows/packages-ci.yml)
[![Security](https://github.com/icon-project/sodax-sdks/actions/workflows/security.yml/badge.svg)](https://github.com/icon-project/sodax-sdks/actions/workflows/security.yml)

# Sodax SDKs

This repository contains the SDK packages and demo applications for the Sodax project, organized as a Turborepo + pnpm monorepo.

## Architecture

SODAX is a cross-chain DeFi platform built on a **hub-and-spoke architecture**, with **Sonic** as the hub chain. It supports swaps (intent-based via solver), lending/borrowing (money market), staking, bridging, DEX (concentrated liquidity), token migration, partner fee operations, and recovery (withdrawing stuck hub-wallet assets) across 20 blockchains:

- **EVM (12):** Sonic, Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia
- **Non-EVM (8):** Solana, Sui, Stellar, ICON, Injective, NEAR, Stacks, Bitcoin

See the [Sodax SDK README](./packages/sdk/README.md) for a deeper architectural overview.

## Repository Structure

### Packages (`/packages`)

- **types** (`/packages/types`) — Shared TypeScript type definitions: chain IDs, chain configs, wallet provider interfaces, backend API types. No runtime dependencies.
- **sdk** (`/packages/sdk`) — Core SDK exposing the full Sodax feature set (swap, bridge, money market, staking, DEX, migration, partner) through a streamlined `Sodax` facade. [Sodax SDK Documentation](./packages/sdk/README.md).
- **wallet-sdk-core** (`/packages/wallet-sdk-core`) — Low-level multi-chain wallet providers (signing, broadcasting) for 9 chain types. Supports both private-key (scripts/testing) and browser-extension (production) configs.
- **wallet-sdk-react** (`/packages/wallet-sdk-react`) — React layer over `wallet-sdk-core` with the `XService`/`XConnector` pattern, Zustand state persistence, and EIP-6963 wallet discovery. [Wallet SDK Documentation](./packages/wallet-sdk-react/README.md).
- **dapp-kit** (`/packages/dapp-kit`) — High-level React hooks combining the SDK, `wallet-sdk-react`, and React Query. Modular, production-ready building blocks for dApp development. [dApp Kit Documentation](./packages/dapp-kit/README.md).

### Apps (`/apps`)

- **demo** (`/apps/demo`) — Vite + React demo app showcasing the SDK.
- **node** (`/apps/node`) — Node.js scripts for E2E testing chain operations, with per-chain entry points.
- **node-cjs** (`/apps/node-cjs`) — CommonJS consumer regression test (verifies SDK CJS output works).
- **wallet-modal-example** (`/apps/wallet-modal-example`) — Vite + React demo for the Wallet React SDK.

## Common Commands

```bash
pnpm i                # Install dependencies
pnpm dev:demo         # Run demo app dev server
pnpm build            # Build everything (packages, then apps)
pnpm build:packages   # Build only SDK packages
pnpm lint             # Lint with Biome (auto-fixes)
pnpm checkTs          # TypeScript type checking across all packages
pnpm test             # Run tests across all packages
```

Package manager: **pnpm 10.32.1**. Tested against Node.js 20.x, 22.x, 24.x.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Publishing

Instructions for releasing new packages: [packages/RELEASE_INSTRUCTIONS.md](./packages/RELEASE_INSTRUCTIONS.md).
