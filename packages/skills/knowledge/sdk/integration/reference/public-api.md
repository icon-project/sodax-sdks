# Public API surface

Import everything from `@sodax/sdk`. The barrel re-exports the entire `@sodax/types` surface — you don't need a separate `@sodax/types` dependency.

### Top-level exports

```ts
import {
  // Main entry
  Sodax,
  type SodaxConfig,
  type DeepPartial,

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
  // …

  // Backend / relay
  type IConfigApi,
  type SubmitSwapTxRequest,
  type SubmitSwapTxResponse,
  relayTxAndWaitPacket,         // function — runs spoke→hub relay submit + wait
  submitTransaction,            // function — relay submit ack only
  type RelayExtraData,
  type IntentRelayChainId,

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
- **Do not depend on `@sodax/types` separately.** It's a transitive of `@sodax/sdk` (bundled via tsup `noExternal`); declaring it as a direct dependency invites version skew.
- **Stable contract:** every export above is part of the public API. Anything not exported from the root barrel is internal — don't reach for it via `dist` paths.
- **Tarball contents:** `dist/` (compiled JS + types). Nothing else ships. Consumer-facing AI docs (this tree) are shipped separately via [`@sodax/skills`](https://github.com/icon-project/sodax-sdks/tree/main/packages/skills).

---


## Cross-references

- [`README.md`](README.md) — reference index.
- [`../architecture.md`](../architecture.md) — concepts behind these tables.
