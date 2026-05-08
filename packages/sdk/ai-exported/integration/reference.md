# Reference — `@sodax/sdk` v2

Lookup tables and inventories. Keep this file open while writing — it's optimised for fast token-cheap retrieval.

## Section index

1. [Chain keys](#1-chain-keys) — 20 chains × family × relay id × address type.
2. [Wallet provider interfaces](#2-wallet-provider-interfaces) — `I*WalletProvider` map + `chainType` discriminants.
3. [Error codes](#3-error-codes) — 13 codes, semantics, common context fields, retry guidance.
4. [Per-method error codes](#4-per-method-error-codes) — narrow code unions per public method.
5. [Public API surface](#5-public-api-surface) — what `@sodax/sdk` barrel exports.
6. [Glossary](#6-glossary) — terms used throughout the docs.

---

## 1. Chain keys

20 supported chains. The `ChainKey` type is the union of every `ChainKeys.*` value. `SpokeChainKey` is the same minus `ChainKeys.SONIC_MAINNET` (the hub).

| `ChainKeys.*` | String value | Family | Hub vs spoke | Address type |
|---|---|---|---|---|
| `SONIC_MAINNET` | `'sonic'` | EVM | **Hub** | `0x${string}` |
| `ETHEREUM_MAINNET` | `'ethereum'` | EVM | spoke | `0x${string}` |
| `ARBITRUM_MAINNET` | `'0xa4b1.arbitrum'` | EVM | spoke | `0x${string}` |
| `BASE_MAINNET` | `'0x2105.base'` | EVM | spoke | `0x${string}` |
| `BSC_MAINNET` | `'0x38.bsc'` | EVM | spoke | `0x${string}` |
| `OPTIMISM_MAINNET` | `'0xa.optimism'` | EVM | spoke | `0x${string}` |
| `POLYGON_MAINNET` | `'0x89.polygon'` | EVM | spoke | `0x${string}` |
| `AVALANCHE_MAINNET` | `'0xa86a.avax'` | EVM | spoke | `0x${string}` |
| `HYPEREVM_MAINNET` | `'hyper'` | EVM | spoke | `0x${string}` |
| `LIGHTLINK_MAINNET` | `'lightlink'` | EVM | spoke | `0x${string}` |
| `REDBELLY_MAINNET` | `'redbelly'` | EVM | spoke | `0x${string}` |
| `KAIA_MAINNET` | `'0x2019.kaia'` | EVM | spoke | `0x${string}` |
| `SOLANA_MAINNET` | `'solana'` | SOLANA | spoke | base58 PublicKey string |
| `SUI_MAINNET` | `'sui'` | SUI | spoke | `0x${string}` (32-byte) |
| `STELLAR_MAINNET` | `'stellar'` | STELLAR | spoke | `G…` |
| `ICON_MAINNET` | `'0x1.icon'` | ICON | spoke | `hx…` / `cx…` |
| `INJECTIVE_MAINNET` | `'injective-1'` | INJECTIVE | spoke | `inj1…` |
| `NEAR_MAINNET` | `'near'` | NEAR | spoke | `<account>.near` / `<hex>` |
| `STACKS_MAINNET` | `'stacks'` | STACKS | spoke | `SP…` / `ST…` |
| `BITCOIN_MAINNET` | `'bitcoin'` | BITCOIN | spoke | `bc1…` / `1…` / `3…` |

### Notes

- `ChainKeys.ICON_MAINNET` is the **string** `'0x1.icon'`, not the legacy numeric chain id. `Number(chainKey)` returns `NaN` for ICON.
- `SONIC_MAINNET` is special-cased — it's `'sonic'` (a simple string) and is the hub chain. `getChainType(ChainKeys.SONIC_MAINNET)` returns `'EVM'` (since Sonic is EVM-compatible) and `'SONIC'` is also a valid family in some contexts.
- Relay chain IDs (used internally for cross-chain coordination) are different from `ChainKey` strings. Convert via `sodax.config.getSpokeChainKeyFromIntentRelayChainId(BigInt(relayId))`.

### Type aliases

| Type | What it is |
|---|---|
| `ChainKey` | Union of all `ChainKeys.*` values (20 chains). |
| `SpokeChainKey` | `ChainKey` minus `'sonic'` (19 spoke chains). |
| `EvmChainKey` | Subset of `ChainKey` for the 12 EVM chains. |
| `HubChainKey` | The literal `'sonic'`. |

### Chain-family helpers

```ts
import {
  getChainType,           // (chainKey) => 'EVM' | 'BITCOIN' | ...
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
} from '@sodax/sdk';
```

---

## 2. Wallet provider interfaces

Every chain family has an `I*WalletProvider` interface. Each declares a `readonly chainType: '<NAME>'` literal field for runtime discrimination.

| Family | Interface | `chainType` literal | Implementation |
|---|---|---|---|
| EVM | `IEvmWalletProvider` | `'EVM'` | `EvmWalletProvider` (private-key or browser-extension) |
| Solana | `ISolanaWalletProvider` | `'SOLANA'` | `SolanaWalletProvider` |
| Sui | `ISuiWalletProvider` | `'SUI'` | `SuiWalletProvider` |
| Stellar | `IStellarWalletProvider` | `'STELLAR'` | `StellarWalletProvider` |
| ICON | `IIconWalletProvider` | `'ICON'` | `IconWalletProvider` (uses `HanaWalletConnector` for browser) |
| Injective | `IInjectiveWalletProvider` | `'INJECTIVE'` | `InjectiveWalletProvider` |
| Stacks | `IStacksWalletProvider` | `'STACKS'` | `StacksWalletProvider` |
| NEAR | `INearWalletProvider` | `'NEAR'` | `NearWalletProvider` |
| Bitcoin | `IBitcoinWalletProvider` | `'BITCOIN'` | `BTCWalletProvider` (PSBT) |

### Common methods

Every `I*WalletProvider` has:

```ts
getWalletAddress(): Promise<string>;
// Returns the chain-specific address (typed as `0x${string}` for EVM, base58 for Solana, etc.).
readonly chainType: '<FAMILY>';
```

Plus chain-specific signing/broadcasting methods. The full per-interface method list is in `@sodax/wallet-sdk-core` (the source package); consumers usually don't call these directly — they pass the provider to SDK methods.

### `GetWalletProviderType<K>`

Given a chain key literal `K`, resolves to the exact wallet provider interface for that chain:

```ts
GetWalletProviderType<typeof ChainKeys.ETHEREUM_MAINNET>  // IEvmWalletProvider
GetWalletProviderType<typeof ChainKeys.SOLANA_MAINNET>    // ISolanaWalletProvider
GetWalletProviderType<typeof ChainKeys.BITCOIN_MAINNET>   // IBitcoinWalletProvider
GetWalletProviderType<SpokeChainKey>                      // IWalletProvider (broad union)
```

### `IWalletProvider` (broad union)

The discriminated union of all 9 `I*WalletProvider` interfaces. Useful when a function accepts any chain's wallet provider:

```ts
import type { IWalletProvider } from '@sodax/sdk';

function logChain(wp: IWalletProvider) {
  console.log(wp.chainType);
}
```

### Constructor configs

Each provider accepts two configs (discriminated by field presence):

| Mode | When | Key fields |
|---|---|---|
| Private key | Node scripts, bots, E2E | `{ privateKey, rpcUrl }` |
| Browser extension | dApps | `{ walletClient }` (EVM), `{ adapter }` (Solana), etc. |

See `@sodax/wallet-sdk-core` source for the full per-provider config types.

---

## 3. Error codes

All 13 codes the SDK can emit. Each error is `SodaxError<C>` where `C` is one of these. The producing feature is on `error.feature`.

| Code | Meaning | Common `error.context` fields | Retry advice |
|---|---|---|---|
| `VALIDATION_FAILED` | Pre-flight invariant tripped (input shape, unsupported chain, etc.). | `field`, `reason`, `phase: 'validate'` | No — fix the input. |
| `INTENT_CREATION_FAILED` | Building the intent / payload failed. | `phase: 'intentCreation'`, `action` | Sometimes — depends on root cause (`error.cause`). |
| `EXECUTION_FAILED` | Orchestrator-level catch-all (multi-step op didn't complete). | `action`, `phase: 'execution'` or `'postExecution'` | Sometimes — inspect cause. |
| `TX_VERIFICATION_FAILED` | Spoke `verifyTxHash` returned false / threw. | `phase: 'verify'`, `srcChainKey` | Sometimes — RPC / indexer issue is transient. |
| `TX_SUBMIT_FAILED` | Spoke tx landed; relay POST submit failed. | `phase: 'submit'`, `relayCode: 'SUBMIT_TX_FAILED'` | Yes — relay submit is retryable; backoff and re-run with the same payload. |
| `RELAY_TIMEOUT` | Destination packet didn't reach `executed` within timeout. | `phase: 'relay'`, `srcChainKey`, `dstChainKey`, `relayCode: 'RELAY_TIMEOUT'` | Yes — increase timeout or re-poll; the spoke tx already landed. |
| `RELAY_FAILED` | Relay polling outage / unrecognised relay error. | `phase: 'relay'`, `relayCode` | Yes — exponential backoff. |
| `APPROVE_FAILED` | Token approval call failed. | `phase: 'approve'` | Sometimes — gas / RPC issues are retryable. |
| `ALLOWANCE_CHECK_FAILED` | Reading on-chain allowance failed. | `phase: 'allowanceCheck'` | Yes — read-only retry is cheap. |
| `GAS_ESTIMATION_FAILED` | Gas estimation returned an error. | `phase: 'gasEstimation'` | Yes — re-estimate is the norm. |
| `LOOKUP_FAILED` | Read-only on-chain query / off-chain config fetch. | `method`, `phase: 'lookup'` | Yes — read-only retry is cheap. |
| `EXTERNAL_API_ERROR` | Upstream API call failed (solver, backend). | `api: 'solver' \| 'backend'`; for solver: `solverCode`, `solverDetail` | Sometimes — depends on `solverCode`. |
| `UNKNOWN` | Last-resort catch in an outer `try`. | (none guaranteed) | Treat as unrecoverable; surface the underlying cause. |

### Features

```ts
type SodaxFeature =
  | 'swap'
  | 'moneyMarket'
  | 'bridge'
  | 'staking'
  | 'migration'
  | 'dex'
  | 'partner'
  | 'recovery';
```

The `(feature, code)` pair is the canonical discriminator. Loggers tag both fields; switch statements branch on both.

### Phase tags (`error.context.phase`)

```ts
type SodaxPhase =
  | 'validate'           // pre-flight invariant
  | 'intentCreation'     // building intent / payload
  | 'verify'             // spoke verifyTxHash
  | 'submit'             // spoke→relay submit
  | 'relay'              // primary relayTxAndWaitPacket wait
  | 'destinationExecution' // secondary watcher (migration's bnUSD waitUntilIntentExecuted)
  | 'execution'          // orchestrator-level catch
  | 'postExecution'      // swap-only post-relay solver step
  | 'approve'            // ERC20 approval call
  | 'allowanceCheck'     // on-chain allowance read
  | 'gasEstimation'      // gas-estimation read
  | 'lookup';            // generic read-only query
```

### `RelayCode` (`error.context.relayCode`)

```ts
type RelayCode =
  | 'SUBMIT_TX_FAILED'
  | 'RELAY_TIMEOUT'
  | 'RELAY_POLLING_FAILED'
  | 'UNKNOWN';
```

This is the lower-level relay-layer code that `mapRelayFailure` maps from. Surfaces on `error.context.relayCode` when the error originated in `IntentRelayApiService`.

---

## 4. Per-method error codes

Narrow code unions per public method. Use these for exhaustive `switch` discrimination.

### Common helper unions (used across features)

```ts
// 'create*Intent' methods
type CreateIntentErrorCode = 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN';

// 'approve' methods
type ApproveErrorCode = 'VALIDATION_FAILED' | 'APPROVE_FAILED' | 'UNKNOWN';

// 'isAllowanceValid' methods
type AllowanceCheckErrorCode = 'VALIDATION_FAILED' | 'ALLOWANCE_CHECK_FAILED' | 'UNKNOWN';

// 'estimateGas' methods
type GasEstimationErrorCode = 'VALIDATION_FAILED' | 'GAS_ESTIMATION_FAILED' | 'UNKNOWN';

// All read-only lookups
type LookupErrorCode = 'VALIDATION_FAILED' | 'LOOKUP_FAILED' | 'UNKNOWN';
```

### Swap (`feature: 'swap'`)

| Method | Narrow code union |
|---|---|
| `createIntent` | `CreateIntentErrorCode` |
| `swap` | All of {`VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `EXECUTION_FAILED`, `TX_VERIFICATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`, `EXTERNAL_API_ERROR`, `UNKNOWN`} |
| `postExecution` | `EXECUTION_FAILED \| EXTERNAL_API_ERROR \| UNKNOWN` (with `phase: 'postExecution'`) |
| `createLimitOrder`, `createLimitOrderIntent` | `CreateIntentErrorCode` |
| `cancelIntent`, `cancelLimitOrder` | `EXECUTION_FAILED \| VALIDATION_FAILED \| UNKNOWN` |

### Money Market (`feature: 'moneyMarket'`)

| Method | Narrow code union |
|---|---|
| `supply`, `borrow`, `withdraw`, `repay` | `VALIDATION_FAILED \| INTENT_CREATION_FAILED \| EXECUTION_FAILED \| TX_VERIFICATION_FAILED \| TX_SUBMIT_FAILED \| RELAY_TIMEOUT \| RELAY_FAILED \| UNKNOWN` (with `action` discriminator) |
| `createSupplyIntent`, `createBorrowIntent`, `createWithdrawIntent`, `createRepayIntent` | `CreateIntentErrorCode` |
| `approve` | `ApproveErrorCode` |
| `isAllowanceValid` | `AllowanceCheckErrorCode` |
| `estimateGas` | `GasEstimationErrorCode` |
| Read-only methods (reserves, user data, etc.) | `LookupErrorCode` |

### Staking (`feature: 'staking'`)

| Method | Narrow code union |
|---|---|
| `stake` | All exec codes including `TX_VERIFICATION_FAILED` (only stake calls verifyTxHash). |
| `unstake`, `instantUnstake`, `claim`, `cancelUnstake` | All exec codes minus `TX_VERIFICATION_FAILED`. |
| `approve` | `ApproveErrorCode` |
| `isAllowanceValid` | `AllowanceCheckErrorCode` |
| `getStakingInfo`, `getUnstakingInfo`, `getStakingConfig`, `getStakeRatio`, `getInstantUnstakeRatio`, `getConvertedAssets`, `getUnstakingInfoWithPenalty`, `getStakingInfoFromSpoke` | `LookupErrorCode` (with `method` discriminator) |

### Bridge (`feature: 'bridge'`)

| Method | Narrow code union |
|---|---|
| `bridge` | All exec codes. |
| `createBridgeIntent` | `CreateIntentErrorCode` |
| `approve` | `ApproveErrorCode` |
| `isAllowanceValid` | `AllowanceCheckErrorCode` |
| `getBridgeableAmount`, `getBridgeableTokens` | `LookupErrorCode` (with `method` discriminator) |

### DEX (`feature: 'dex'`)

| Method | Narrow code union |
|---|---|
| `assetService.deposit`, `assetService.withdraw` | All exec codes. |
| `clService.supplyLiquidity`, `clService.increaseLiquidity`, `clService.decreaseLiquidity`, `clService.claimRewards` | All exec codes. |
| `assetService.approve` | `ApproveErrorCode` |
| `assetService.isAllowanceValid` | `AllowanceCheckErrorCode` |
| `clService.getPoolData`, `clService.getPositionInfo`, `assetService.getDeposit` | `LookupErrorCode` |

### Migration (`feature: 'migration'`)

| Method | Narrow code union |
|---|---|
| `migratebnUSD` | All exec codes; `direction: 'forward' \| 'reverse'` on context. |
| `migrateIcxToSoda`, `revertMigrateSodaToIcx`, `migrateBaln` | All exec codes. |
| `createXxxIntent` (4 of these) | `CreateIntentErrorCode` |
| `approve` | `ApproveErrorCode` |
| `isAllowanceValid` | `AllowanceCheckErrorCode` |
| `getAvailableAmount` | `LookupErrorCode` |

### Partner (`feature: 'partner'`) and Recovery (`feature: 'recovery'`)

Both follow the same shape: action methods get the full exec union (`'EXECUTION_FAILED' \| 'INTENT_CREATION_FAILED' \| ...`), read methods get `LookupErrorCode`, approve methods get `ApproveErrorCode`.

---

## 5. Public API surface

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
  type IntentRelayApiService,
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
- **Tarball contents:** `dist/` (compiled JS + types) and `ai-exported/` (this docs tree). Nothing else ships.

---

## 6. Glossary

| Term | Definition |
|---|---|
| **Hub** | Sonic. The single chain through which every cross-chain operation routes. Hosts the asset manager, wallet abstraction, and vault contracts. |
| **Spoke** | Any of the 19 non-hub chains. Cross-chain operations enter and exit the system through spokes. |
| **Spoke service** | An internal SDK service (e.g. `EvmSpokeService`) that owns the chain-family-specific logic. Owned by `SpokeService` (singular, the router). Consumers never construct one. |
| **Chain key** | A string identifier for a chain (e.g. `'ethereum'`, `'0xa4b1.arbitrum'`). Type: `ChainKey` (full set) or `SpokeChainKey` (spoke chains only). Listed under `ChainKeys.*`. |
| **Chain family** | The class of chain (`'EVM'`, `'BITCOIN'`, `'SOLANA'`, …). Resolved via `getChainType(chainKey)`. |
| **Wallet provider** | A chain-specific signer/broadcaster (`IEvmWalletProvider`, etc.). Constructed by the consumer; passed into SDK calls. |
| **Intent** | A user-signed declaration of intended cross-chain action. The unit of solver-mediated swap. |
| **Solver** | An off-chain market maker that fulfills swap intents. The `SwapService` coordinates with the solver via `SolverApiService`. |
| **Relay** | The off-chain layer that propagates spoke→hub transactions. Implemented by `IntentRelayApiService`. |
| **Relay chain id** | A bigint identifier used internally by the relay layer. **Different** from `ChainKey`. Convert via `sodax.config.getSpokeChainKeyFromIntentRelayChainId(BigInt(...))`. |
| **Vault** | Hub-side ERC4626 contract that holds wrapped/unified spoke tokens. Each `XToken` carries its `vault` address directly. |
| **Hub asset** | Hub-side token address representing a spoke asset on the hub chain. Each `XToken` carries its `hubAsset` address directly. |
| **Hub wallet abstraction** | A user-specific contract on the hub that holds funds during cross-chain ops. Resolved via `EvmHubProvider.getUserHubWalletAddress(...)`. |
| **`Result<T>`** | The `{ ok: true; value: T } \| { ok: false; error: E }` discriminated union returned by every async public method. |
| **`SodaxError<C>`** | The canonical error class. Discriminated by `(feature, code)`. |
| **Code (`SodaxErrorCode`)** | One of 13 reason-only error codes. See § 3. |
| **Feature (`SodaxFeature`)** | One of 8 producing features (`'swap'`, `'moneyMarket'`, …). |
| **Phase (`SodaxPhase`)** | The orchestration step at which an error occurred. See § 3. |
| **Action (`error.context.action`)** | The user-facing operation that triggered the error (`'supply'`, `'stake'`, `'migrateBaln'`, …). |
| **`raw: true / false`** | The discriminator on `WalletProviderSlot<K, Raw>`. `true` = build unsigned tx; `false` = sign and broadcast. |

---

## Cross-references

- Architectural concepts (full prose explanation of the table topics): [`architecture.md`](architecture.md).
- Recipes that use the lookups: [`recipes.md`](recipes.md).
- Per-feature method-level error catalogues: [`features/`](features/).
- v1 → v2 deletions and renames: [`../migration/breaking-changes/architecture.md`](../migration/breaking-changes/architecture.md) Appendix A.
