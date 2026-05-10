# Deleted exports inventory

Every v1 export removed from `@sodax/sdk` and `@sodax/types`, with its v2 replacement. If you see `error TS2305: Module '"@sodax/sdk"' has no exported member '<X>'`, find `<X>` in the left column.

### Spoke-provider classes + guards

| v1 export | v2 replacement |
|---|---|
| `EvmSpokeProvider` (class) | None — pass `walletProvider` + `srcChainKey` to SDK calls. See [`../breaking-changes/architecture.md`](../breaking-changes/architecture.md) § 1. |
| `SonicSpokeProvider` (class) | Same. |
| `SolanaSpokeProvider` (class) | Same. |
| `SuiSpokeProvider` (class) | Same. |
| `IconSpokeProvider` (class) | Same. |
| `InjectiveSpokeProvider` (class) | Same. |
| `StellarSpokeProvider` / `StellarBaseSpokeProvider` (classes) | Same. |
| `StacksSpokeProvider` (class) | Same. |
| `BitcoinSpokeProvider` (class) | Same. |
| `NearSpokeProvider` (class) | Same. |
| `SpokeProvider` (union type) | None — broad-union typing replaced by `srcChainKey: SpokeChainKey` + `walletProvider: GetWalletProviderType<K>`. |
| `isEvmSpokeProvider`, `isSolanaSpokeProvider`, `isBitcoinSpokeProvider`, `isStellarSpokeProvider`, `isIconSpokeProvider`, `isSuiSpokeProvider`, `isInjectiveSpokeProvider`, `isStacksSpokeProvider`, `isNearSpokeProvider`, `isSonicSpokeProvider` | `getChainType(chainKey) === '<FAMILY>'`, or family-level `is<Family>ChainKeyType(chainKey)` from `@sodax/sdk`. See [`../breaking-changes/architecture.md`](../breaking-changes/architecture.md) § 1. |

### Static lookup tables and helpers

| v1 export | v2 replacement |
|---|---|
| `hubAssets` | `XToken.vault` / `XToken.hubAsset` baked in; or `sodax.config.getOriginalAssetAddress(...)`. See [`../breaking-changes/architecture.md`](../breaking-changes/architecture.md) § 2. |
| `moneyMarketSupportedTokens` | `sodax.moneyMarket.getSupportedTokensByChainId(chainKey)` / `getSupportedTokens()`. |
| `solverSupportedTokens` | `sodax.config.getSupportedSwapTokensByChainId(chainKey)`. |
| `SodaTokens` | `sodax.config.getMoneyMarketReserveAssets()` / `sodax.moneyMarket.getSupportedReserves()`. |
| `getHubChainConfig()` | `sodax.config.*` lookups; specific chain configs are loaded by `ConfigService.initialize()`. |
| `EvmWalletAbstraction` (class) | `sodax.hubProvider.getUserHubWalletAddress(...)` (the equivalent functionality lives on `EvmHubProvider`, accessed via the `Sodax` instance). |

### Type aliases

| v1 export | v2 replacement |
|---|---|
| `ChainId` (type) | `SpokeChainKey` (or `ChainKey` for the broader union including the hub). |
| `SpokeChainId` (type) | `SpokeChainKey`. |
| `EvmChainId` (type) | `EvmChainKey` (subset of `SpokeChainKey`). |
| `HubChainId` (type) | `HubChainKey` (literal `'sonic'`). |
| `Token` (type) | `XToken`. See [`../breaking-changes/type-system.md`](../breaking-changes/type-system.md) § 4. |
| `AddressType` (type) | `BtcAddressType`. See [`../breaking-changes/type-system.md`](../breaking-changes/type-system.md) § 7. |
| `BtcWalletAddressType` (type) | `BtcAddressType` (cleaned-up name). |
| `Payload` (type) | None — internal `IntentRelayApiService` shape that v1 leaked publicly. Consumers calling the relay layer directly should use `relayTxAndWaitPacket` / `submitTransaction` (which take typed inputs). |

### Constants

| v1 export | v2 replacement |
|---|---|
| `*_MAINNET_CHAIN_ID` (20 constants) | `ChainKeys.*` (single namespace). See [`../breaking-changes/type-system.md`](../breaking-changes/type-system.md) § 1 for the full table. |

### Wallet shims

| v1 export | v2 replacement |
|---|---|
| `CustomProvider` (Hana-wallet window typedecl) | None. Window declaration becomes `unknown` or imports directly from the wallet vendor. Low-level Hana-extension helper functions (`requestAddress`, `requestSigning`, `requestJsonRpc`) ship from `@sodax/sdk` for consumers building their own Hana-based `IIconWalletProvider`. |

### Error types and guards

| v1 export | v2 replacement |
|---|---|
| `MoneyMarketError<MoneyMarketErrorCode>`, plus `MoneyMarketErrorCode` | `SodaxError<C>` with `feature: 'moneyMarket'`. See [`error-code-crosswalk.md`](error-code-crosswalk.md) for code crosswalk. |
| `IntentError<IntentErrorCode>`, plus the union | `SodaxError<C>` with `feature: 'swap'`. |
| `StakingError<StakingErrorCode>`, plus the union | `SodaxError<C>` with `feature: 'staking'`. |
| `BridgeError<BridgeErrorCode>`, plus the union | `SodaxError<C>` with `feature: 'bridge'`. |
| `MigrationError<MigrationErrorCode>`, plus the union | `SodaxError<C>` with `feature: 'migration'`. |
| `AssetServiceError<AssetServiceErrorCode>`, plus the union | `SodaxError<C>` with `feature: 'dex'`. |
| `ConcentratedLiquidityError<ConcentratedLiquidityErrorCode>`, plus the union | `SodaxError<C>` with `feature: 'dex'`. |
| `RelayError<RelayErrorCode>`, plus the union | `SodaxError<C>` with relay code on `error.context.relayCode`. |
| `PartnerFeeClaimError<...>` (5 partner errors) | `SodaxError<C>` with `feature: 'partner'`. |
| `isMoneyMarketError`, `isIntentError`, `isStakingError`, `isBridgeError`, `isMigrationError`, `isAssetServiceError`, `isConcentratedLiquidityError`, `isRelayError` (type-guards) | `isSodaxError(e)` + check `e.feature === '<feature>'`, or use `isFeatureError('<feature>')` to build a guard. See [`../breaking-changes/result-and-errors.md`](../breaking-changes/result-and-errors.md) § 6 for migration patterns. |
| `isIntentPostExecutionFailedError(e)` | `isSodaxError(e) && e.feature === 'swap' && e.code === 'EXECUTION_FAILED' && e.context?.phase === 'postExecution'`. |
| `isIntentSubmitTxFailedError(e)` | `isSodaxError(e) && e.code === 'TX_SUBMIT_FAILED'`. |

### Per-feature param shape

These types changed shape (typically: gained a generic `<K extends SpokeChainKey>`, gained `srcChainKey` and `srcAddress` required fields). The v1 names still exist but with a different signature — fixing imports won't compile, you also need to update construction.

| v1 type | v2 type | Required additions in v2 |
|---|---|---|
| `MoneyMarketSupplyParams` | `MoneyMarketSupplyParams<K extends SpokeChainKey>` | `srcChainKey: K`, `srcAddress: GetAddressType<K>` |
| `MoneyMarketBorrowParams` | `MoneyMarketBorrowParams<K>` | Same; plus optional `dstChainKey`, `dstAddress` for cross-chain. |
| `MoneyMarketWithdrawParams` | `MoneyMarketWithdrawParams<K>` | Same. |
| `MoneyMarketRepayParams` | `MoneyMarketRepayParams<K>` | Same; plus optional `dstChainKey`/`dstAddress` (debt chain). |
| `StakeParams`, `UnstakeParams`, `InstantUnstakeParams`, `ClaimParams`, `CancelUnstakeParams` | All gained `<K>` generic | `srcChainKey: K`, `srcAddress: GetAddressType<K>`. v1 `account` field renamed to `srcAddress`. |
| `MigrationParams` | `MigrationParams<K>` | Same. |
| `UnifiedBnUSDMigrateParams` | `UnifiedBnUSDMigrateParams<K>` | Same. |
| `CreateAssetDepositParams`, `CreateAssetWithdrawParams`, `ClSupplyParams`, `ClIncreaseLiquidityParams`, `ClDecreaseLiquidityParams`, `ClClaimRewardsParams` | All gained `<K>` generic | `srcChainKey`, `srcAddress`. |
| `CreateIntentParams`, `CreateLimitOrderParams` | All gained `<K>` generic | Field renames `srcChain` → `srcChainKey`, `dstChain` → `dstChainKey` (v1 `srcChain` was a chain id type, now `srcChainKey: K`). |

The [`error TS1360`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-2.html#smarter-type-alias-preservation) pattern (`Type '{ token, amount, action }' does not satisfy the expected type 'MoneyMarketSupplyParams'`) is the typecheck signature: a literal that matches v1's shape but missing v2's required `srcChainKey` and `srcAddress`. Add both.

---


## Cross-references

- [`README.md`](README.md) — migration reference index.
- [`../README.md`](../README.md) — migration overview.
- [`../checklist.md`](../checklist.md) — top-level migration checklist.
