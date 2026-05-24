# @sodax/wallet-sdk-core

The Sodax wallet-sdk-core is a core wallet SDK package containing implementations of wallet providers that enable multi-chain wallet connectivity. This package provides TypeScript implementations of wallet providers for various blockchain networks, making them compatible with the Core Sodax SDK (@sodax/sdk).

> **AI-friendly docs:** shipped via [`@sodax/skills`](https://github.com/icon-project/sodax-sdks/tree/main/packages/skills) — [`skills` CLI](https://github.com/vercel-labs/skills) recommended; npm + `AGENTS.md` pointer as fallback. See [docs/ai-integration-guide.md](https://github.com/icon-project/sodax-sdks/blob/main/docs/ai-integration-guide.md) for all install modes and per-tool wiring.

## Installation

```bash
# Using pnpm (recommended)
pnpm add @sodax/wallet-sdk-core

# Using npm
npm install @sodax/wallet-sdk-core

# Using yarn
yarn add @sodax/wallet-sdk-core
```

## Features

- **Multi-chain Support**: Wallet provider implementations for multiple blockchain networks
- **TypeScript Compatibility**: Fully typed implementations compatible with @sodax/sdk
- **Wallet Provider Interface**: Standardized interface for wallet connectivity across different chains
- **Core Integration**: Seamless integration with the Core Sodax SDK

## Supported Wallet Providers

The package includes wallet provider implementations for:
- EVM-compatible chains ✅
- Solana ✅
- Sui ✅
- Stellar ✅
- ICON ✅
- Injective ✅
- Near ✅
- Stacks ✅
- Bitcoin ✅

## Public API surface

The package root exports:

- Wallet providers from `src/wallet-providers/*` (e.g. `EvmWalletProvider`, `SolanaWalletProvider`, `BitcoinWalletProvider`)
- `library-exports` from `src/types/library-exports.ts` (types and a few runtime values re-exported from upstream chain SDKs)

Internal utilities (e.g. `shallowMerge` in `src/utils/merge.ts`) are **not** exported from the package root.

## Config variants (private key vs browser/extension)

All providers support two modes, but **the union discriminant depends on the provider**:

- **Field presence (no `type` field in config)**: EVM, Solana, Sui, Near, Stacks, Icon, Injective
- **Explicit uppercase `type` field**: Bitcoin, Stellar (`'PRIVATE_KEY' | 'BROWSER_EXTENSION'`)

### EVM

```ts
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys } from '@sodax/types';

// Private key (Node/scripts/CI)
const evmPk = new EvmWalletProvider({
  privateKey: '0x...',
  chainId: ChainKeys.SONIC_MAINNET,
  rpcUrl: 'https://...',
  defaults: {
    sendTransaction: { gas: 3_000_000n },
  },
});

// Browser/extension (consumer supplies viem clients)
const evmBrowser = new EvmWalletProvider({
  walletClient: myViemWalletClient,
  publicClient: myViemPublicClient,
});
```

### Solana

```ts
import { SolanaWalletProvider } from '@sodax/wallet-sdk-core';

const solanaPk = new SolanaWalletProvider({
  privateKey: new Uint8Array([]),
  endpoint: 'https://api.mainnet-beta.solana.com',
});

const solanaBrowser = new SolanaWalletProvider({
  wallet: {
    publicKey: myPublicKeyOrNull,
    signTransaction: mySignTransactionOrUndefined,
  },
  endpoint: 'https://api.mainnet-beta.solana.com',
});
```

### Bitcoin

```ts
import { BitcoinWalletProvider } from '@sodax/wallet-sdk-core';

const btcPk = new BitcoinWalletProvider({
  type: 'PRIVATE_KEY',
  privateKey: '0x...',
  network: 'TESTNET',
  defaults: { defaultFinalize: true },
});

const btcBrowser = new BitcoinWalletProvider({
  type: 'BROWSER_EXTENSION',
  walletsKit: myWalletsKit,
  network: 'TESTNET',
});
```

### Sui

Sui uses `mnemonics` (not `privateKey`) for private-key mode. Browser extension requires a pre-constructed `SuiClient`, wallet object, and active `WalletAccount`.

```ts
import { SuiWalletProvider } from '@sodax/wallet-sdk-core';

// Private key (Node/scripts/CI) — field presence discriminant
const suiPk = new SuiWalletProvider({
  rpcUrl: 'https://...',
  mnemonics: '...',
});

// Browser/extension
const suiBrowser = new SuiWalletProvider({
  client: mySuiClient,
  wallet: myWalletWithFeatures,
  account: myWalletAccount,
});
```

### Stellar

Stellar uses an explicit uppercase `type` field (`'PRIVATE_KEY' | 'BROWSER_EXTENSION'`).

```ts
import { StellarWalletProvider } from '@sodax/wallet-sdk-core';

// Private key (Node/scripts/CI)
const stellarPk = new StellarWalletProvider({
  type: 'PRIVATE_KEY',
  privateKey: '0x...',
  network: 'PUBLIC',
  rpcUrl: 'https://...',
});

// Browser/extension
const stellarBrowser = new StellarWalletProvider({
  type: 'BROWSER_EXTENSION',
  walletsKit: myStellarWalletsKit,
  network: 'PUBLIC',
});
```

### Stacks

Stacks discriminates by field presence (no `type` field). The private-key config has `privateKey`; the browser-extension config has `address` (and optionally a `StacksProvider`).

```ts
import { StacksWalletProvider } from '@sodax/wallet-sdk-core';

// Private key (Node/scripts/CI)
const stacksPk = new StacksWalletProvider({
  privateKey: '...',
  endpoint: 'https://...',
});

// Browser/extension
const stacksBrowser = new StacksWalletProvider({
  address: 'SP...',
  endpoint: 'https://...',
  provider: myStacksProvider,
});
```

### ICON

ICON discriminates by field presence. The browser-extension config uses an optional `walletAddress` field (not a client object); `rpcUrl` is required in both modes.

```ts
import { IconWalletProvider } from '@sodax/wallet-sdk-core';

// Private key (Node/scripts/CI)
const iconPk = new IconWalletProvider({
  privateKey: '0x...',
  rpcUrl: 'https://...',
});

// Browser/extension (Hana wallet)
const iconBrowser = new IconWalletProvider({
  walletAddress: 'hx...',
  rpcUrl: 'https://...',
});
```

### Injective

Injective discriminates by field presence. The private-key config uses a nested `secret` object that accepts either `{ privateKey }` or `{ mnemonics }` — it is named `SecretInjectiveWalletConfig` rather than `PrivateKey*` to reflect this dual credential shape.

```ts
import { InjectiveWalletProvider } from '@sodax/wallet-sdk-core';

// Private key path — via secret credential
const injectivePk = new InjectiveWalletProvider({
  secret: { privateKey: '...' },
  chainId: myChainId,
  network: myNetwork,
});

// Mnemonics path — same config shape, different secret variant
const injectiveMnemonic = new InjectiveWalletProvider({
  secret: { mnemonics: '...' },
  chainId: myChainId,
  network: myNetwork,
});

// Browser/extension
const injectiveBrowser = new InjectiveWalletProvider({
  msgBroadcaster: myMsgBroadcaster,
});
```

### NEAR

NEAR discriminates by field presence. The private-key config requires `rpcUrl`, `accountId`, and `privateKey`; the browser-extension config wraps a `NearConnector`.

```ts
import { NearWalletProvider } from '@sodax/wallet-sdk-core';

// Private key (Node/scripts/CI)
const nearPk = new NearWalletProvider({
  rpcUrl: 'https://...',
  accountId: '...',
  privateKey: '...',
});

// Browser/extension
const nearBrowser = new NearWalletProvider({
  wallet: myNearConnector,
});
```

## Defaults and merge semantics

Each provider accepts optional `defaults`, and most methods accept per-call options. The SDK combines layers using a **shallow merge**:

- Only top-level keys are merged; **nested objects are replaced**, not deep-merged.
- `undefined` layers are skipped.
- `undefined` values inside a layer are skipped (so `{ field: undefined }` means “don’t override the previous layer”).

## `library-exports`

`library-exports` re-exports types (and a few runtime values) from underlying chain SDKs so consumers can reduce direct dependencies.

Example:

```ts
import type { WalletClient, PublicClient } from '@sodax/wallet-sdk-core';
```