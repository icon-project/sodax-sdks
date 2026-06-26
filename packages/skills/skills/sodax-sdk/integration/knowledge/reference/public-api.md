# Public API surface

Import everything from `@sodax/sdk`. The barrel re-exports the entire `@sodax/types` surface — you don't need a separate `@sodax/types` dependency.

`sodax.api` is an alias for `sodax.backendApi`; `sodax.api.swaps` is the typed Swaps API v2 client (`SwapsApiService`) — see [`../features/swaps-api.md`](../features/swaps-api.md).

### Top-level exports

```ts
import {
  // Main entry
  Sodax,
  type SodaxOptions, // constructor param: DeepPartial<SodaxDefaultConfig> & client options (logger + global fee)
  type SodaxConfig, // merged result: SodaxDefaultConfig & client options (e.g. sodax.instanceConfig)
  type SodaxDefaultConfig, // static data contract the backend serves / defaults are built from
  type DeepPartial,

  // Logging (see recipes/logging.md)
  type SodaxLogger,
  type SodaxLoggerOption,
  consoleLogger,
  silentLogger,
  resolveLogger,

  // Chain keys + narrowing
  ChainKeys,
  type ChainKey,
  type SpokeChainKey,
  type HubChainKey,
  type EvmChainKey,
  getChainType,
  isEvmChainKeyType,
  isSolanaChainKeyType,
  isStellarChainKeyType,
  isSuiChainKeyType,
  isIconChainKeyType,
  isInjectiveChainKeyType,
  isStacksChainKeyType,
  isNearChainKeyType,
  isBitcoinChainKeyType,
  isHubChainKeyType,
  type GetChainType,
  type GetWalletProviderType,
  type GetAddressType,

  // Type system primitives
  type Result,
  type WalletProviderSlot,
  type TxReturnType,
  type EvmRawTransaction,
  type SolanaRawTransaction,
  // …per-chain raw-tx types

  // Errors
  SodaxError,
  type SodaxErrorCode,
  type SodaxFeature,
  type SodaxPhase,
  type SodaxErrorContext,
  type RelayCode,
  isSodaxError,
  isFeatureError,
  isCodeMember,
  sodaxInvariant,
  swapInvariant,
  mmInvariant,
  bridgeInvariant,
  stakingInvariant,
  migrationInvariant,
  dexInvariant,
  partnerInvariant,
  recoveryInvariant,
  leverageYieldInvariant,
  mapRelayFailure,

  // Tokens
  type XToken,
  type BtcAddressType,

  // Service classes (constructed by Sodax — usually you don't import these directly)
  // …

  // Wallet provider interfaces
  type IWalletProvider,
  type IEvmWalletProvider,
  type ISolanaWalletProvider,
  type ISuiWalletProvider,
  type IStellarWalletProvider,
  type IIconWalletProvider,
  type IInjectiveWalletProvider,
  type IStacksWalletProvider,
  type INearWalletProvider,
  type IBitcoinWalletProvider,

  // Param types (per feature)
  type CreateIntentParams,
  type CreateLimitOrderParams,
  type MoneyMarketSupplyParams,
  type MoneyMarketBorrowParams,
  type MoneyMarketWithdrawParams,
  type MoneyMarketRepayParams,
  type StakeParams,
  type UnstakeParams,
  type InstantUnstakeParams,
  type ClaimParams,
  type CancelUnstakeParams,
  type CreateAssetDepositParams,
  type CreateAssetWithdrawParams,
  type ClSupplyParams,
  type ClIncreaseLiquidityParams,
  type ClDecreaseLiquidityParams,
  type ClClaimRewardsParams,
  type MigrationParams,
  type UnifiedBnUSDMigrateParams,
  type LeverageYieldSwapDepositParams,
  type LeverageYieldSwapWithdrawParams,
  type LeverageYieldSwapPayload,
  type VaultSwapActionParams,
  type VaultSwapResponse,
  type CreateVaultIntentResult,
  type LeverageYieldApr,
  type LeverageYieldEffectiveApr,
  type LeverageYieldLsdApr,
  type LeverageYieldPosition,
  type LeverageYieldVault,
  // …

  // Backend / relay
  type IConfigApiV1,
  type SubmitTxRequestV2,       // swaps API submit-tx request (sodax.api.swaps.submitTx)
  type SubmitTxResponseV2,      // swaps API submit-tx response
  relayTxAndWaitPacket,         // function — runs spoke→hub relay submit + wait
  submitTransaction,            // function — relay submit ack only
  type RelayExtraData,
  type IntentRelayChainId,

  // Backend API config + per-call override
  type ApiConfig,               // BaseApiConfig | CustomApiConfig
  type BaseApiConfig,
  type CustomApiConfig,         // point the swaps API at its own endpoint
  type SwapsApiConfig,
  type RequestOverrideConfig,   // per-call override on any backendApi / sodax.api.swaps method

  // Read shapes
  type Intent,
  type IntentResponse,
  type SwapResponse,
  type CreateIntentResult,
  type TxHashPair,
} from '@sodax/sdk';
```

This is a partial list — see `src/index.ts` of the published tarball for the authoritative barrel.

### Rules

- **Import only from `@sodax/sdk` root.** No deep imports from `dist/...`.
- **Do not depend on `@sodax/types` separately.** It's a transitive of `@sodax/sdk` (force-bundled via tsup `noExternal`); declaring it as a direct dependency invites version skew.
- **Stable contract:** every export above is part of the public API. Anything not exported from the root barrel is internal — don't reach for it via `dist` paths.
- **Tarball contents:** `dist/` (compiled JS + types). Nothing else ships. Consumer-facing AI docs (this tree) are shipped separately via [`@sodax/skills`](https://github.com/icon-project/sodax-sdks/tree/main/packages/skills).

---


## Cross-references

- [`README.md`](README.md) — reference index.
- [`../architecture.md`](../architecture.md) — concepts behind these tables.
