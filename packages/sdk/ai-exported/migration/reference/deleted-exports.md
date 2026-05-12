# Deleted / replaced exports inventory

Every v1 export that's gone or repurposed in v2 — and its v2 successor. If you see `error TS2305: Module '"@sodax/sdk"' has no exported member '<X>'`, find `<X>` in the left column.

Two categories worth distinguishing:
- **Truly deleted** — the v1 symbol is gone; an import will fail compile (`TS2305`).
- **Name preserved, shape replaced** — a v1 `import` still compiles, but the runtime shape changed. Silent breakage if you read v1-only fields.

> Scope note: This doc only lists symbols that **don't import anymore** or **silently changed shape**. For v1 static constants that are still exported in v2 but should yield to the dynamic service API, see [`../breaking-changes/architecture.md`](../breaking-changes/architecture.md) § 2.

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
| `getHubChainConfig()` (free function) | `sodax.config.getHubChainConfig()` (now a method on `ConfigService`, accessed via the `Sodax` instance). |
| `EvmWalletAbstraction` (class) | `sodax.hubProvider.getUserHubWalletAddress(...)` (the equivalent functionality lives on `EvmHubProvider`, accessed via the `Sodax` instance). |

### Type aliases

| v1 export | v2 replacement |
|---|---|
| `ChainId` (type) | `SpokeChainKey` (or `ChainKey` for the broader union including the hub). |
| `SpokeChainId` (type) | `SpokeChainKey`. |
| `EvmChainId` (type) | `EvmChainKey` (subset of `SpokeChainKey`). |
| `HubChainId` (type) | `HubChainKey` (literal `'sonic'`). |
| `Token` (type) | `XToken`. See [`../breaking-changes/type-system.md`](../breaking-changes/type-system.md) § 4. |
| `AddressType` (type — `'P2PKH' \| 'P2SH' \| 'P2WPKH' \| 'P2TR'`) | `BtcAddressType` (renamed; same shape). See [`../breaking-changes/type-system.md`](../breaking-changes/type-system.md) § 7. |
| `Payload` (type) | None — internal `IntentRelayApiService` shape that v1 leaked publicly. Consumers calling the relay layer directly should use `relayTxAndWaitPacket` / `submitTransaction` (which take typed inputs). |

> Note: `BtcWalletAddressType` (`'taproot' | 'segwit'`, wallet-UI choice) is preserved in v2 with the same shape — it is **not** the same thing as `BtcAddressType` (on-chain address format). They coexist; do not blindly rename one to the other.

### Constants

| v1 export | v2 replacement |
|---|---|
| `*_MAINNET_CHAIN_ID` (20 constants) | `ChainKeys.*` (single namespace). See [`../breaking-changes/type-system.md`](../breaking-changes/type-system.md) § 1 for the full table. |

### Wallet shims

| v1 export | v2 replacement |
|---|---|
| `CustomProvider` (Hana-wallet window typedecl) | None. Window declaration becomes `unknown` or imports directly from the wallet vendor. Low-level Hana-extension helper functions (`requestAddress`, `requestSigning`, `requestJsonRpc`) ship from `@sodax/sdk` for consumers building their own Hana-based `IIconWalletProvider`. |

### Error types and guards

#### Error types — name preserved, shape replaced

The following v1 error types were **plain object literals** `{ code: T; data: GetXxxError<T> }`. v2 keeps the same export names but redefines them as type aliases for the canonical `SodaxError<NarrowCode>` class instance. **A v1 `import { MoneyMarketError } from '@sodax/sdk'` still compiles** — but reading `err.data` will silently fail at runtime because the v2 shape is `{ name, code, feature, message, stack, context, cause }`. Treat these as "shape replaced" rather than deleted.

| v1 shape | v2 shape | What to read |
|---|---|---|
| `MoneyMarketError<MoneyMarketErrorCode> = { code, data }` | `MoneyMarketError = SodaxError<MoneyMarketErrorCode>` (class instance) | `err.code`, `err.feature === 'moneyMarket'`, `err.context`, `err.cause`. See [`error-code-crosswalk.md`](error-code-crosswalk.md) for code crosswalk. |
| `BridgeError<BridgeErrorCode> = { code, data }` | `BridgeError = SodaxError<BridgeErrorCode>` | Same pattern; `err.feature === 'bridge'`. |
| `StakingError<StakingErrorCode> = { code, data }` | `StakingError = SodaxError<StakingErrorCode>` | Same pattern; `err.feature === 'staking'`. |
| `MigrationError<MigrationErrorCode> = { code, data }` | `MigrationError = SodaxError<MigrationErrorCode>` | Same pattern; `err.feature === 'migration'`. |

#### Error types — fully deleted

| v1 export | v2 replacement |
|---|---|
| `IntentError<IntentErrorCode>`, plus `IntentErrorCode`, `IntentErrorData` | `SwapError = SodaxError<SwapErrorCode>` (renamed). `feature: 'swap'`. |
| `AssetServiceError<AssetServiceErrorCode>`, plus the union | `DexError = SodaxError<DexErrorCode>`. `feature: 'dex'`. |
| `ConcentratedLiquidityError<ConcentratedLiquidityErrorCode>`, plus the union | `DexError = SodaxError<DexErrorCode>` (asset + CL collapsed into one feature). |
| `RelayError<RelayErrorCode>`, plus the union | `SodaxError<C>` with the lower-level relay code on `error.context.relayCode`. |
| `SetSwapPreferenceError`, `CreateIntentAutoSwapError`, `WaitIntentAutoSwapError`, `UnknownIntentAutoSwapError`, `ExecuteIntentAutoSwapError` (5 distinct partner error types in `PartnerFeeClaimService.ts`) | `PartnerError = SodaxError<PartnerErrorCode>`. `feature: 'partner'`. |

#### Type guards — deleted

v1 only exposed **specific per-failure-mode guards**. v2 deleted all of these and instead ships **feature-level guards** + helper builders (`isFeatureError('<feature>')`, `isCodeMember(codeSet)`).

| v1 deleted guard | v2 replacement |
|---|---|
| `isIntentCreationFailedError(e)` | `isSwapCreateIntentError(e)` or `isSodaxError(e) && e.code === 'INTENT_CREATION_FAILED' && e.feature === 'swap'`. |
| `isIntentSubmitTxFailedError(e)` | `isSodaxError(e) && e.code === 'TX_SUBMIT_FAILED'`. |
| `isIntentPostExecutionFailedError(e)` | `isSodaxError(e) && e.feature === 'swap' && e.code === 'EXECUTION_FAILED' && e.context?.phase === 'postExecution'`. |
| `isWaitUntilIntentExecutedFailed(e)` | `isSodaxError(e) && e.feature === 'swap' && e.code === 'RELAY_TIMEOUT'`. The v1 guard fired when the destination packet never reached `executed`; in v2 that surfaces as the unified `RELAY_TIMEOUT` code (with the underlying relay code on `error.context.relayCode`). |
| `isIntentCreationUnknownError(e)` | `isSodaxError(e) && e.code === 'UNKNOWN' && e.feature === 'swap'`. |
| `isMoneyMarketSubmitTxFailedError`, `isMoneyMarketRelayTimeoutError`, `isMoneyMarketCreate{Supply,Borrow,Withdraw,Repay}IntentFailedError`, `isMoneyMarket{Supply,Borrow,Withdraw,Repay}UnknownError` (10 specific guards) | `isMoneyMarketError(e)` (new in v2) for the feature-level check, then narrow on `e.code` / `e.context.action`. |
| `isCreateIntentAutoSwapError`, `isWaitIntentAutoSwapError`, `isUnknownIntentAutoSwapError`, `isSetSwapPreferenceError` (4 partner guards) | `isPartnerError(e)` (new in v2) for the feature-level check, then narrow on `e.code` / `e.context.action`. |

> Note: `isMoneyMarketError`, `isBridgeError`, `isStakingError`, `isMigrationError`, `isSwapError`, `isDexError`, `isPartnerError`, `isRecoveryError` did **not** exist in v1 — v2 added them as new feature-level guards alongside `isSodaxError` and the `isFeatureError('<feature>')` factory. See [`../breaking-changes/result-and-errors.md`](../breaking-changes/result-and-errors.md) § 6 for migration patterns.

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
- [`../breaking-changes/architecture.md`](../breaking-changes/architecture.md) § 2 — guidance for v1 static constants that are still exported but should yield to the service API after `await sodax.config.initialize()`.
