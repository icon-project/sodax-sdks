# Aleo Integration — `sdk-v2-main` merge changelog

This document tracks every Aleo-specific change introduced when merging
`sdk-v2-main` into `sdk/aleo-integration`. The v2 refactor eliminated the
per-chain `*SpokeProvider` entity pattern and moved to a chain-key-routed
`SpokeService` with `getChainType(chainKey)` switching, configurable wallet
providers, and structured action params (`DepositParams<C, R>`,
`SendMessageParams<K, Raw>`, etc.).

Every Aleo bit below was either ported into v2 idiom or added fresh. Use this
file as the index for "where did Aleo go."

## At-a-glance

```
Aleo plugs into v2 the same way Near does:
- New chain type ALEO in ChainTypeArr / ChainKeys
- New AleoSpokeChainConfig + aleoSupportedTokens
- New IAleoWalletProvider with chainType: 'ALEO' discriminant
- New instance-based AleoSpokeService inside SpokeService
- New AleoXService / AleoXConnector wired through chainRegistry
- AleoSpokeProvider entity REMOVED (v2 eliminated all SpokeProvider entities)
```

## packages/types

### `src/chains/chain-keys.ts`
- Added `'ALEO'` to `ChainTypeArr`.
- Added `ALEO_MAINNET: 'aleo'` to `ChainKeys`.

### `src/chains/chains.ts`
- Added Aleo entry to `RelayChainIdMap` — `[ChainKeys.ALEO_MAINNET]: 6694886634401n`.
- Added Aleo entry to `baseChainInfo` (`name: 'Aleo'`, `type: 'ALEO'`, `chainId: 'aleo'`).
- New types: `AleoChainKey`, `AleoAddress` (`` `aleo1${string}` ``),
  `AleoSpokeChainConfig` (with `addresses` for asset_manager / connection /
  credits / token_registry, `mappings`, `nativeToken`, `gasPrice`, `rpcUrl`).
- New constants: `ALEO_CHAIN_KEYS`, `ALEO_CHAIN_KEYS_SET`.
- Added Aleo to the `SpokeChainConfig` union and to `GetSpokeChainConfigType`.
- Added Aleo entry to `spokeChainConfig` with mainnet program IDs:
  `asset_manager_core_v1.aleo`, `connection_v1.aleo`, `rate_limit_v1.aleo`,
  `credits.aleo`, `token_registry.aleo`.

### `src/chains/tokens.ts`
- New `aleoSupportedTokens` with the `ALEO` native token (`decimals: 6`,
  numeric field-encoded address).
- Added Aleo entry to the chain → tokens map.

### `src/aleo/index.ts` (new file)
- `IAleoWalletProvider` extends `ICoreWallet` with the `chainType: 'ALEO'`
  discriminator (matches Near/Bitcoin/etc. v2 pattern).
- `AleoExecuteOptions`, `AleoExecutionResult`, `AleoTransactionReceipt`,
  `AleoRawTransaction`, `AleoEoaAddress`, `AleoTransactionId`, `AleoProgramId`.
- `AleoReturnType<Raw>` (mirror of `NearReturnType` etc.).

### `src/wallet/providers.ts`
- `IAleoWalletProvider` added to the `IWalletProvider` union.
- `GetWalletProviderType<C>` mapped `'ALEO' → IAleoWalletProvider`.

### `src/common/common.ts`
- `RawTxReturnType` and `TxReturnType` extended with the `'ALEO'` branch
  (`AleoReturnType<Raw>` / `AleoRawTransaction`).
- `GetEstimateGasReturnType` extended with `'ALEO' → AleoGasEstimate`
  (`= bigint | number`).
- New `AleoGasEstimate` export.
- `GetTokenAddressType` and `GetAddressType` keep `string` for ALEO via
  the default branch.

### `src/utils/utils.ts`
- New `isAleoChainKey(chainKey)` predicate (parallel to other
  `is<Chain>ChainKey` helpers).

### `src/swap/swap.ts`, `src/moneyMarket/moneyMarket.ts`
- Aleo entries appended to module-local supported-token records that need
  `Record<SpokeChainKey, …>` exhaustiveness.

### `src/index.ts`
- Re-exports the new `aleo/index.js`.

## packages/sdk

### `src/shared/services/spoke/AleoSpokeService.ts` (new file, replaces old static class)
- Instance-based service (matches `NearSpokeService` shape):
  ```ts
  new AleoSpokeService(config: ConfigService)
  ```
- Public methods all take v2-style structured params with
  `WalletProviderSlot<AleoChainKey, Raw>`:
  - `estimateGas(params: EstimateGasParams<AleoChainKey>)`
  - `deposit(params: DepositParams<AleoChainKey, R>)`
  - `getDeposit(params: GetDepositParams<AleoChainKey>)`
  - `sendMessage(params: SendMessageParams<AleoChainKey, Raw>)`
  - `waitForTransactionReceipt(params: WaitForTxReceiptParams<AleoChainKey>)`
- Lazy-loads `@provablehq/sdk` so SSR / CJS consumers don't load the WASM
  module at import time.
- Keeps the Aleo-specific quirks (`U64_MAX` amount cap, `connSn` generation,
  `feeAmount`, `hubChainId`, `hubAddress` passed as inputs because Aleo
  transitions can't read mappings).

### `src/shared/services/spoke/SpokeService.ts`
- Added `aleoSpokeService: AleoSpokeService` field, instantiated in the
  constructor.
- Added `case 'ALEO':` branches to every routing switch:
  `getSpokeService`, `estimateGas`, `deposit`, `getDeposit`, `sendMessage`,
  `waitForTxReceipt` — including `verifyDepositSimulation` and
  `verifySimulation` calls so the v2 simulation pipeline runs for Aleo too.
- Added `AleoSpokeService` to `SpokeServiceType` union and
  `GetSpokeServiceType<C>` conditional type.

### `src/shared/services/spoke/index.ts`
- Re-exports `AleoSpokeService.js`.

### `src/shared/utils/shared-utils.ts`
- Added `case 'ALEO':` to `encodeAddress` — bech32m decode → reversed bytes
  → hex (matches the on-chain field encoding the Aleo program expects).
- The `reverseEncodeAddress` ALEO branch returns the native `aleo1…` bech32m
  string.

### `src/shared/guards.ts`
- New `isAleoChainKeyType(chainKey)` runtime guard.
- New `isAleoWalletProviderType(provider)` (narrows on `chainType === 'ALEO'`).
- ALEO branches in `isUndefinedOrValidWalletProviderForChainKey` and
  `isDefinedWalletProviderValidForChainKey`.

### `src/shared/services/intentRelay/IntentRelayApiService.ts`
- Aleo added to the split-tx-data submit path (Aleo tx hashes use the
  same comma-split encoding as Solana / Bitcoin in v2).

### `src/shared/entities/aleo/AleoSpokeProvider.ts` — **REMOVED**
- v2 eliminated all `*SpokeProvider` entity classes. State that lived on
  the provider (chainConfig, network client, wallet) is now passed per-call
  via params + read from `ConfigService`. Aleo follows the same elimination.

### `src/shared/entities/index.ts`
- `aleo/` re-export removed (paired with the deletion above).

## packages/wallet-sdk-core

### `src/wallet-providers/AleoWalletProvider.ts`
- Implements `IAleoWalletProvider` from `@sodax/types`.
- Declares `readonly chainType = 'ALEO' as const` so it narrows correctly
  via the `IWalletProvider` discriminated union.
- Lazy-imports `@provablehq/sdk` (kept from HEAD) to avoid SSR WASM issues.

### `src/wallet-providers/index.ts`
- `export * from './AleoWalletProvider.js'`.

## packages/wallet-sdk-react

### `src/chainRegistry.ts`
- New `ALEO` entry registers the `AleoXService` constructor (chain → service
  factory, parallel to all other chains).

### `src/types/config.ts`
- New `AleoChainEntry` type and `ALEO` entry in the `ChainMeta` map so
  configurable wallet providers per chain include Aleo.

### `src/xchains/aleo/AleoXService.ts`
- Implements `IXService` (`xChainType: 'ALEO'`) with `getBalance` /
  `getBalances` against the Aleo RPC.
- Uses `override` on `xChainType` (TS strict requirement under v2 tsconfig).
- Imports rewritten from `@/…` aliases to relative paths so tsup resolves
  inside the package boundary.

### `src/xchains/aleo/AleoXConnector.ts`
- Bridges the Leo browser extension to the v2 connector contract; constructs
  the `IAleoWalletProvider` on connect.
- Same `@/` → relative cleanup.

### `src/xchains/aleo/index.ts`
- Re-exports the two above.

### Hook signatures (`useXAccounts`, `useXConnect`, `useXConnectors`,
`useXConnection`, `useXDisconnect`, `useXSignMessage`, `useWalletProvider`,
`getXService`, `useXWagmiStore`, `SodaxWalletProvider`, `index.ts`)
- Inherited the v2 instance-based / standardized signatures (PR #1261).
- Aleo handled implicitly because `chainType: 'ALEO'` is now part of the
  `ChainType` union and the chainRegistry knows about it — no per-hook
  Aleo branches needed.

## packages/dapp-kit

### `src/hooks/provider/useSpokeProvider.ts`
- Took v2 baseline. Aleo flows through via the chainKey, no special-cased
  Aleo provider construction (the v2 hook returns a thin spoke service
  reference, not a per-chain provider class).

## apps/demo

### `src/constants.ts`, `src/providers.tsx`
- v2 baseline + Aleo wired into the wallet-provider config and chain
  selector list. The Aleo provider follows the same `walletProviders[chainKey]`
  registration pattern as Near / Bitcoin.

## apps/web

- v2 baseline taken verbatim. Web app does not yet expose Aleo to end users
  (intentional — same reasoning as commit `27f08dc7`: "remove aleo from web
  app until SDK is published"). When the web app is ready to surface Aleo,
  it will pick it up automatically through the registered chain key.

## What was deleted vs. kept

| Concern                              | Decision                                           |
|--------------------------------------|----------------------------------------------------|
| `AleoSpokeProvider` entity class     | **Deleted** — v2 eliminated all SpokeProviders     |
| `AleoRawSpokeProvider` config        | **Deleted** — same reason                          |
| Old `packages/types/src/constants/`  | **Deleted** — replaced by v2's `chains/` + `common/`|
| Old `packages/sdk/src/shared/types.ts` (SpokeProvider unions) | **Deleted** — v2 split into `types/spoke-types.ts` etc. |
| Old `packages/sdk/src/shared/entities/Providers.ts` | **Deleted** — same   |
| `AleoSpokeService` (old static class) | **Rewritten** as instance-based v2 service        |
| `AleoXService`, `AleoXConnector`     | **Kept**, paths and overrides cleaned for v2      |
| Aleo type definitions (`IAleoWalletProvider` etc.) | **Kept**, moved into v2's `aleo/` subdir |
| Aleo wallet provider implementation  | **Kept**, with `chainType: 'ALEO'` discriminator added |

## Verification

```bash
pnpm build:packages
```

All five packages compile clean:

- `@sodax/types` — tsc clean
- `@sodax/sdk` — tsup ESM + CJS, type defs emitted
- `@sodax/wallet-sdk-core` — tsup clean
- `@sodax/wallet-sdk-react` — tsup clean
- `@sodax/dapp-kit` — tsup clean

The package CI workflow (`.github/workflows/packages-ci.yml`) is what gates
v2 — apps are not part of CI in v2, so any pre-existing app TypeScript
breakage (e.g. `apps/node/src/swap.ts` still imports v1 names) is unrelated
to this merge. None of the app errors mention Aleo.

## Where to look first when extending Aleo

- **Adding a token?** `packages/types/src/chains/tokens.ts` →
  `aleoSupportedTokens` + the chain's `spokeChainConfig.supportedTokens`.
- **Wiring a new feature?** Feature service in `packages/sdk/src/<feature>/`
  routes through `this.spoke.getSpokeService(chainKey)` — no Aleo branch
  needed, the router handles it.
- **Wallet UI / connectors?** `packages/wallet-sdk-react/src/xchains/aleo/`.
- **Backend RPC / on-chain reads/writes?**
  `packages/sdk/src/shared/services/spoke/AleoSpokeService.ts`.
