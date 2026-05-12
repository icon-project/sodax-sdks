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
| Chains and tokens | `ChainKeys`, `SpokeChainKey`, `ChainType`, `baseChainInfo`, `spokeChainConfig`, `supportedTokensByChain` |
| Wallet providers | `WalletAddressProvider`, `ICoreWallet`, `IWalletProvider`, `GetWalletProviderType` |
| Chain transaction types | `EvmRawTransaction`, `BitcoinRawTransaction`, `SolanaRawTransaction`, `StellarRawTransaction`, `SuiRawTransaction`, `IconRawTransaction`, `InjectiveRawTransaction`, `NearRawTransaction`, `StacksRawTransaction` |
| Backend API contracts | `IConfigApi`, `GetAllConfigApiResponse`, `SubmitSwapTxRequest`, `SubmitSwapTxResponse`, `SubmitSwapTxStatusResponse` |
| Product configuration | `sodaxConfig`, `bridgeConfig`, `swapsConfig`, `moneyMarketConfig`, `dexConfig`, `concentratedLiquidityConfig` |
| Utilities | `DeepPartial`, `getChainType`, `getEvmChainKeyByChainId`, chain guard helpers, bnUSD token helpers |

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
