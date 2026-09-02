# @sodax/types

Shared SODAX type definitions, constants, and configuration for SDK packages and applications.

This package includes chain and token metadata, wallet provider interfaces, transaction and receipt types, backend API contracts, swap and money market configuration, DEX configuration, and common utilities.

## Install

```bash
pnpm add @sodax/types
```

## Usage

Import shared types, constants, configuration, and helpers from the root package:

```typescript
import {
  ChainKeys,
  CONFIG_VERSION,
  getEvmChainKeyByChainId,
  sodaxConfig,
  supportedTokensByChain,
} from '@sodax/types';

import type {
  Address,
  DeepPartial,
  EvmRawTransaction,
  IBitcoinWalletProvider,
  IEvmWalletProvider,
  IWalletProvider,
  SpokeChainKey,
  WalletAddressProvider,
} from '@sodax/types';
```

DEX types and constants are also available from the dedicated DEX subpath export:

```typescript
import { concentratedLiquidityConfig, dexConfig } from '@sodax/types/dex';

import type { ConcentratedLiquidityConfig, DexConfig, PoolKey } from '@sodax/types/dex';
```

The package currently exposes only the root export (`@sodax/types`) and the DEX export (`@sodax/types/dex`). Chain-specific types such as `IEvmWalletProvider`, `BitcoinRawTransaction`, and `SolanaRawTransactionReceipt` are available from the root package.

## Export Overview

| Area | Examples |
| --- | --- |
| Shared primitives | `Address`, `Hex`, `Hash`, `Base64String`, `HttpUrl`, `TxPollingConfig` |
| Common types and constants | `Result`, `PartnerFee`, `TxReturnType`, `apiConfig`, `solverConfig`, retry and timeout constants |
| Chains and tokens | `ChainKeys`, `SpokeChainKey`, `ChainType`, `baseChainInfo`, `spokeChainConfig` [^cfg], `supportedTokensByChain` |
| Wallet providers | `WalletAddressProvider`, `ICoreWallet`, `IWalletProvider`, `GetWalletProviderType` |
| Chain transaction types | `EvmRawTransaction`, `BitcoinRawTransaction`, `SolanaRawTransaction`, `StellarRawTransaction`, `SuiRawTransaction`, `IconRawTransaction`, `InjectiveRawTransaction`, `NearRawTransaction`, `StacksRawTransaction` |
| Backend API contracts | `IConfigApi`, `GetAllConfigApiResponse`, `SubmitSwapTxRequest`, `SubmitSwapTxResponse`, `SubmitSwapTxStatusResponse` |
| Product configuration | `sodaxConfig` [^cfg], `bridgeConfig`, `swapsConfig`, `moneyMarketConfig`, `dexConfig`, `concentratedLiquidityConfig` |
| Utilities | `DeepPartial`, `getChainType`, `getEvmChainKeyByChainId`, chain guard helpers, bnUSD token helpers |

[^cfg]: `spokeChainConfig` and `sodaxConfig` (and the related `hubConfig`, etc.) are **packaged-default snapshots** frozen at SDK release time. They are safe to import at module scope, but **direct imports do NOT reflect overrides passed to `new Sodax(config)` or dynamic config loaded by `sodax.config.initialize()`** — those flow into the `ConfigService` only. Once a `Sodax` instance exists, prefer the instance-scope readers: `sodax.config.spokeChainConfig`, `sodax.config.getChainConfig(chainKey)`, `sodax.config.sodaxConfig`, `sodax.config.getHubChainConfig()`, etc. Mixing a static import with a custom-configured `Sodax` instance will silently fall back to defaults for any chain you customized.

## Wallet Providers

All wallet providers extend the base wallet address contract:

```typescript
interface WalletAddressProvider {
  getWalletAddress(): Promise<string>;
  getPublicKey?: () => Promise<string>;
}
```

`ICoreWallet` extends `WalletAddressProvider`, and each chain-specific provider adds its own signing, transaction, and query methods. The root export includes provider interfaces for all supported chain families:

| Chain family | Provider interface |
| --- | --- |
| EVM | `IEvmWalletProvider` |
| Bitcoin | `IBitcoinWalletProvider` |
| Solana | `ISolanaWalletProvider` |
| Stellar | `IStellarWalletProvider` |
| Sui | `ISuiWalletProvider` |
| ICON | `IIconWalletProvider` |
| Injective | `IInjectiveWalletProvider` |
| NEAR | `INearWalletProvider` |
| Stacks | `IStacksWalletProvider` |

Use `IWalletProvider` for the union of all chain-specific wallet providers, or `GetWalletProviderType<C>` to map a `SpokeChainKey` or `ChainType` to the matching provider interface.

```typescript
import type { GetWalletProviderType, IEvmWalletProvider, IWalletProvider, SpokeChainKey } from '@sodax/types';

type ProviderForChain<C extends SpokeChainKey> = GetWalletProviderType<C>;

function isEvmProvider(provider: IWalletProvider): provider is IEvmWalletProvider {
  return provider.chainType === 'EVM';
}
```

## Address Types

`GetAddressType<C>` is the type the SDK's address parameters (`srcAddress`, `owner`, …) declare for a `SpokeChainKey` or `ChainType`. Each chain family carries its own address encoding — a Solana address is a base58 public key, not a hex string.

| Chain family | Declared type | Encoding to pass |
| --- | --- | --- |
| EVM | `Address` | `0x…` |
| ICON | `IconAddress` | `hx…` (or `cx…` for a contract) |
| Solana | `SolanaBase58PublicKey` | base58 public key |
| Sui | `Hex` | `0x…` (32-byte) |
| Stellar | `Hex` [^addr] | `G…` ed25519 strkey |
| NEAR | `Address` [^addr] | account id (`alice.near`, or a 64-char implicit account) |
| Injective, Stacks | `string` | `inj1…` / `SP…`, `ST…` |

[^addr]: Stellar and NEAR declare a hex type their chain does not use. The Stellar spoke service passes the address to `Address.fromString` and `loadAccount`, which need a `G…` strkey; the NEAR spoke service passes it as a NEAR account id (`signerId`, `accountId`). Pass the chain's own encoding — the declared type is wrong here, not the chain.

`Address`, `Hex` and `IconAddress` are template-literal types, so the compiler does check the prefix. `SolanaBase58PublicKey` and the `string` entries are plain aliases with no branding — nothing there catches a wrong-encoding address until the chain's own SDK rejects it at runtime.

```typescript
import type { GetAddressType, SpokeChainKey } from '@sodax/types';

type AddressForChain<C extends SpokeChainKey> = GetAddressType<C>;
```

`GetTokenAddressType<C>` is the token-address counterpart: `Address` for EVM chains, `string` everywhere else.
