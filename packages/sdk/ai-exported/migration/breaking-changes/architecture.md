# Architecture breaking changes — v1 → v2

The structural changes that reshaped the SDK at the service / runtime layer. Read after [`type-system.md`](type-system.md) — by the time you arrive here, your imports should compile and the rest is wiring.

The four load-bearing shifts:

1. **Per-chain `*SpokeProvider` classes are deleted.** Routing is by chain key, dispatched internally by `SpokeService`.
2. **Static lookup tables (`hubAssets`, `moneyMarketSupportedTokens`, `SodaTokens`) are deleted.** Lookups go through `sodax.config.*`.
3. **Relay flow is centralised.** Two functions (`relayTxAndWaitPacket`, `submitTransaction`) and one mapper (`mapRelayFailure`) replace per-feature relay helpers.
4. **Invariants and guards are unified.** `sodaxInvariant` + per-feature aliases (`swapInvariant`, `mmInvariant`, etc.) and `isSodaxError` / `isFeatureError` replace ad-hoc throws and module-specific type guards.

---

## 1. Spoke-provider deletion

### What's gone

These v1 classes and their union are **deleted**:

- `EvmSpokeProvider`
- `SonicSpokeProvider`
- `SolanaSpokeProvider`
- `SuiSpokeProvider`
- `IconSpokeProvider`
- `InjectiveSpokeProvider`
- `StellarSpokeProvider`
- `StacksSpokeProvider`
- `BitcoinSpokeProvider`
- `NearSpokeProvider`
- The union type `SpokeProvider`
- The instance-test functions: `isEvmSpokeProvider`, `isSolanaSpokeProvider`, `isBitcoinSpokeProvider`, `isStellarSpokeProvider`, `isIconSpokeProvider`, `isSuiSpokeProvider`, `isInjectiveSpokeProvider`, `isStacksSpokeProvider`, `isNearSpokeProvider`, `isSonicSpokeProvider`.

### What replaces them

A single internal router, `SpokeService`, owned by the `Sodax` instance. It holds one per-chain-family service (`EvmSpokeService`, `SolanaSpokeService`, …) and exposes `getSpokeService(chainKey)` for internal feature services. **Consumers never construct or hold a reference to a spoke service.** They pass `walletProvider` and a `srcChainKey` literal, and the SDK dispatches.

### Migration mechanics

#### v1: construct + pass

```ts
// v1
const evmWp = new EvmWalletProvider({ privateKey: '0x…', rpcUrl: '…' });
const sourceProvider = new EvmSpokeProvider({ walletProvider: evmWp, chainConfig: ARBITRUM_MAINNET_CONFIG });

await sodax.swaps.createIntent({ intentParams, spokeProvider: sourceProvider });
```

#### v2: pass directly

```ts
// v2
const evmWp = new EvmWalletProvider({ privateKey: '0x…', rpcUrl: '…' });

await sodax.swaps.createIntent({
  params: { ...intentParams, srcChainKey: ChainKeys.ARBITRUM_MAINNET, srcAddress },
  raw: false,
  walletProvider: evmWp,
});
```

The chain config is no longer something the consumer constructs — it's loaded by `ConfigService` from the backend (with a fallback to packaged defaults). The chain key on the payload tells the SDK which spoke service to route to.

### Replacing instance tests with chain-key guards

```diff
- if (isBitcoinSpokeProvider(provider)) { /* … */ }
+ if (chainKey === ChainKeys.BITCOIN_MAINNET) { /* … */ }

- if (provider instanceof StellarSpokeProvider) { /* … */ }
+ if (chainKey === ChainKeys.STELLAR_MAINNET) { /* … */ }

- if (isEvmSpokeProvider(provider)) { /* … */ }
+ if (getChainType(chainKey) === 'EVM') { /* … */ }
```

`getChainType(chainKey)` (from `@sodax/sdk`) returns `'EVM' | 'BITCOIN' | 'SOLANA' | 'STELLAR' | 'SUI' | 'ICON' | 'INJECTIVE' | 'STACKS' | 'NEAR'` and is the canonical chain-family discriminator.

Family-level helper guards (`isEvmChainKeyType`, `isBitcoinChainKeyType`, `isSolanaChainKeyType`, etc.) are also exported from `@sodax/sdk` for cases where you want a typed boolean.

### Replacing reads from a spoke-provider instance

If your v1 code reached into a spoke provider for chain config or wallet info, those reads now have direct sources:

| v1 access | v2 source |
|---|---|
| `provider.chainConfig.chain.name` | `baseChainInfo[chainKey].name` (from `@sodax/sdk`) |
| `provider.chainConfig.chain.type` | `getChainType(chainKey)` |
| `provider.walletProvider.getWalletAddress()` | The wallet provider you passed in — call `walletProvider.getWalletAddress()` directly. (In React, use `useXAccount(chainKey).address`.) |
| `provider.publicClient` (EVM only) | If you absolutely need it: `sodax.hubProvider.publicClient` exists for hub-side reads. Spoke-side public clients aren't surfaced — use the typed read methods on each feature service instead. |

### Pitfall

If your project has 17 call sites still using `useSpokeProvider(chainKey, walletProvider)` (the v1 React helper), don't try to recreate the helper in v2 — it intentionally doesn't exist. Pass `walletProvider` directly into each SDK call payload. The v1 ergonomics are preserved by the React wallet hook (`useWalletProvider(chainKey)`) which already returns the correctly-typed wallet provider.

---

## 2. ConfigService replaces static lookups

### What's gone

| v1 global | v2 replacement |
|---|---|
| `hubAssets[chainId][address]` (vault lookup) | `token.vault` directly (added to `XToken` — see [`type-system.md`](type-system.md) § 4) |
| `hubAssets[chainId][address]` (hub-asset address) | `token.hubAsset` directly |
| `moneyMarketSupportedTokens[chainId]` | `sodax.moneyMarket.getSupportedTokensByChainId(chainKey)` |
| `Object.entries(moneyMarketSupportedTokens)` | `sodax.moneyMarket.getSupportedTokens()` (returns `Record<SpokeChainKey, XToken[]>`) |
| `SodaTokens` registry (vault-validation) | `sodax.config.getMoneyMarketReserveAssets()` or `sodax.moneyMarket.getSupportedReserves()` |
| `solverSupportedTokens[chainId]` | `sodax.config.getSolverSupportedTokens(chainKey)` |
| `baseChainInfo[chain].id` | `baseChainInfo[chain].key` (field renamed) |

### What replaces them

`ConfigService` is a stateful service owned by `Sodax`. It loads chain/token config from the backend API on `await sodax.config.initialize()` and falls back to packaged defaults from `@sodax/types` if the backend is unreachable. After init, every lookup goes through the service:

```ts
const sodax = new Sodax(/* optional config override */);
await sodax.config.initialize();   // fetch from backend, fall back on failure

// Token lookups
const usdc = sodax.config.findSupportedTokenBySymbol(ChainKeys.ARBITRUM_MAINNET, 'USDC');
const supportedOnChain = sodax.config.getSupportedTokensPerChain();

// Hub-asset / vault lookups (when the XToken doesn't carry it)
const original = sodax.config.getOriginalAssetAddress(hubAddress);

// Chain validity
const isValid = sodax.config.isSupportedChain(chainKey);
```

Feature services (`SwapService`, `MoneyMarketService`, …) receive `ConfigService` via constructor injection and use it internally — consumer-side code reads the same data through `sodax.config.*` or feature-specific wrappers like `sodax.moneyMarket.getSupportedTokens()`.

### Migration mechanics

```diff
- import { hubAssets, moneyMarketSupportedTokens } from '@sodax/types';
- const vault = hubAssets[chainId]?.[token.address]?.vault;
+ const vault = token.vault;  // baked into XToken in v2

- const supplyTokens = moneyMarketSupportedTokens[chainId];
+ const supplyTokens = sodax.moneyMarket.getSupportedTokensByChainId(chainKey);
```

If your code walked `hubAssets` to find "is this address a known vault?":

```diff
- const isKnownVault = !!hubAssets[chainId]?.[address];
+ const isKnownVault = sodax.config.getMoneyMarketReserveAssets()
+   .some(asset => asset.address === address);
```

### Pitfall

The `swaps` config field changed semantics. v1 put solver endpoints under `SodaxConfig.swaps`. v2 has two fields:

- `SodaxConfig.swaps`: `SwapsConfig` listing supported solver tokens per chain (data, not endpoints).
- `SodaxConfig.solver`: `{ intentsContract, solverApiEndpoint, protocolIntentsContract }` (the endpoint/contract config that v1 misplaced under `swaps`).

If you pass a config override to `new Sodax({ ... })`, put solver endpoints in `solver`, not `swaps`.

---

## 3. Relay flow and intent-relay reshape

### What changed

v1 had per-feature relay helpers (each feature module had its own `*WaitForRelay()` or `relay*Tx()` function). v2 centralises this into `IntentRelayApiService` with two public entry points:

- `submitTransaction({ srcChainKey, txHash, payload })` — POSTs the spoke transaction to the relay submit endpoint and resolves the relay's first-stage acknowledgement.
- `relayTxAndWaitPacket({ srcChainKey, dstChainKey, txHash, payload, timeout? })` — runs `submitTransaction` and then polls until the destination packet reaches `executed`. Resolves with `{ srcTxHash, dstTxHash, packet }` on success.

Internally, every feature service now calls `relayTxAndWaitPacket` for the spoke→hub leg. Failures from this layer surface to consumers via `mapRelayFailure`.

### `RELAY_ERROR_CODES` — the public relay-layer contract

The relay layer keeps a stable string vocabulary on its own errors (these are **not** `SodaxErrorCode` values — they are the lower-level relay codes that get mapped):

```ts
type RelayCode =
  | 'SUBMIT_TX_FAILED'
  | 'RELAY_TIMEOUT'
  | 'RELAY_POLLING_FAILED'
  | 'UNKNOWN';
```

When a relay-layer failure surfaces as a `SodaxError`, the original relay code lives on `error.context.relayCode`.

### `mapRelayFailure` — single shared mapper

v1 had five per-feature mappers (each feature reshaped relay errors into its own typed-error union). v2 collapses them into one:

```ts
import { mapRelayFailure } from '@sodax/sdk';

const mapped = mapRelayFailure(error, {
  feature: 'swap',
  action: 'createIntent',
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  dstChainKey: ChainKeys.STELLAR_MAINNET,
  // phase: 'destinationExecution',  // optional override; used by migration's bnUSD secondary watcher
});
```

`mapped` is a `SodaxError<C>` with code in {`'TX_SUBMIT_FAILED'`, `'RELAY_TIMEOUT'`, `'RELAY_FAILED'`, `'EXECUTION_FAILED'`} and `feature` set to the requested value. Consumers don't usually call `mapRelayFailure` directly — every feature service does this internally — but it's exported for custom orchestration code.

### Migration mechanics for consumers

If your v1 code wrapped a feature call to handle relay failures:

```diff
- try {
-   const tx = await sodax.swaps.createIntent({ intentParams, spokeProvider });
- } catch (e) {
-   if (e instanceof RelayError && e.code === 'RELAY_TIMEOUT') { /* … */ }
-   else if (e instanceof IntentError) { /* … */ }
- }

+ const result = await sodax.swaps.createIntent({ params, raw: false, walletProvider });
+ if (!result.ok) {
+   if (isSodaxError(result.error)) {
+     if (result.error.code === 'RELAY_TIMEOUT') { /* … */ }
+     else if (result.error.feature === 'swap' && result.error.code === 'INTENT_CREATION_FAILED') { /* … */ }
+   }
+ }
```

The full v1 ↔ v2 code crosswalk is in [`result-and-errors.md`](result-and-errors.md) § "v1 ↔ v2 code crosswalk".

### Pitfall

`relayTxAndWaitPacket` is the public name; v1 had `submitTxAndWaitForPacket` and similar variants. If your v1 code imported or wrapped one of those names, the export is gone. Use `relayTxAndWaitPacket` directly, or call the feature service's higher-level method (`sodax.swaps.swap(...)`, `sodax.bridge.bridge(...)`) which wraps it.

---

## 4. Invariants and guards

### What's gone

- Per-module typed error unions and their type-guards: `MoneyMarketError`, `IntentError`, `StakingError`, `BridgeError`, `MigrationError`, `AssetServiceError`, `ConcentratedLiquidityError`, `RelayError`, plus 5 partner error types and their `is<Module>Error()` helpers. (Structural deletion — see [`type-system.md`](type-system.md) § 10.)
- Ad-hoc precondition throws (`if (!x) throw new Error('Amount must be greater than 0')`).

### What replaces them

#### `sodaxInvariant` + per-feature aliases

Every feature has a 1-line alias for `sodaxInvariant` that pre-fills the `feature` field:

```ts
// Internal SDK helpers (also exported for custom code)
import {
  sodaxInvariant,
  swapInvariant,
  mmInvariant,
  bridgeInvariant,
  stakingInvariant,
  migrationInvariant,
  dexInvariant,
  partnerInvariant,
  recoveryInvariant,
} from '@sodax/sdk';

mmInvariant(amount > 0n, 'Amount must be greater than 0');
// Throws SodaxError<'VALIDATION_FAILED'> with feature: 'moneyMarket' and the message above.
```

In your own consumer code, if you have your own preconditions, use `sodaxInvariant` directly (you pick the feature):

```ts
sodaxInvariant(
  isSupportedChain(chainKey),
  'Unsupported source chain',
  { feature: 'swap', context: { reason: 'unsupportedChain', srcChainKey: chainKey } },
);
```

#### `isSodaxError` and `isFeatureError`

```ts
import { isSodaxError, isFeatureError } from '@sodax/sdk';

if (isSodaxError(e)) {
  // e: SodaxError<SodaxErrorCode>
}

const isMmError = isFeatureError('moneyMarket');
if (isMmError(e)) {
  // e: SodaxError<SodaxErrorCode> with feature: 'moneyMarket'
}
```

`isFeatureError` is a guard factory. Use it once at module top and then as a normal type guard:

```ts
const isSwapError = isFeatureError('swap');
const isStakingError = isFeatureError('staking');
```

#### `isCodeMember` for per-method narrowing

When a public method declares a narrow code union (e.g. `useSupplyError`), there's a corresponding `isUseSupplyError` guard you can apply to discriminate within a single feature:

```ts
// Inside per-feature errors.ts files (referenced by per-method types)
const SUPPLY_CODES: ReadonlySet<SupplyErrorCode> = new Set([
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'EXECUTION_FAILED',
  'TX_VERIFICATION_FAILED',
  'RELAY_TIMEOUT',
  // …
]);
const isSupplyError = isCodeMember(SUPPLY_CODES);
```

You can build your own `isCodeMember(codes)` guards from `@sodax/sdk` exports.

### Pitfall

Don't try to recreate a typed-error union by aliasing `SodaxError` per feature — it defeats the design. The whole point of v2's error model is that one class with `(feature, code)` discrimination covers every case, and your switch statements use those two fields. If your v1 code had `try { … } catch (e: MoneyMarketError) { ... }`, replace the catch with `if (isSodaxError(e) && e.feature === 'moneyMarket')`.

---

## Appendix A: Deleted exports inventory

Every v1 export removed from `@sodax/sdk` and `@sodax/types`, with its v2 replacement. If you see `error TS2305: Module '"@sodax/sdk"' has no exported member '<X>'`, find `<X>` in the left column.

### Spoke-provider classes + guards

| v1 export | v2 replacement |
|---|---|
| `EvmSpokeProvider` (class) | None — pass `walletProvider` + `srcChainKey` to SDK calls. See § 1. |
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
| `isEvmSpokeProvider`, `isSolanaSpokeProvider`, `isBitcoinSpokeProvider`, `isStellarSpokeProvider`, `isIconSpokeProvider`, `isSuiSpokeProvider`, `isInjectiveSpokeProvider`, `isStacksSpokeProvider`, `isNearSpokeProvider`, `isSonicSpokeProvider` | `getChainType(chainKey) === '<FAMILY>'`, or family-level `is<Family>ChainKeyType(chainKey)` from `@sodax/sdk`. See § 1. |
| `useSpokeProvider` (React hook in dapp-kit) | None — use `useWalletProvider(chainKey)` and pass `walletProvider` directly into SDK call payloads. (Out of scope: this is a dapp-kit symbol, but consumer codebases typically import it transitively.) |

### Static lookup tables and helpers

| v1 export | v2 replacement |
|---|---|
| `hubAssets` | `XToken.vault` / `XToken.hubAsset` baked in; or `sodax.config.getOriginalAssetAddress(...)`. See § 2. |
| `moneyMarketSupportedTokens` | `sodax.moneyMarket.getSupportedTokensByChainId(chainKey)` / `getSupportedTokens()`. |
| `solverSupportedTokens` | `sodax.config.getSolverSupportedTokens(chainKey)`. |
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
| `Token` (type) | `XToken`. See [`type-system.md`](type-system.md) § 4. |
| `AddressType` (type) | `BtcAddressType`. See [`type-system.md`](type-system.md) § 7. |
| `BtcWalletAddressType` (type) | `BtcAddressType` (cleaned-up name). |
| `Payload` (type) | None — internal `IntentRelayApiService` shape that v1 leaked publicly. Consumers calling the relay layer directly should use `relayTxAndWaitPacket` / `submitTransaction` (which take typed inputs). |

### Constants

| v1 export | v2 replacement |
|---|---|
| `*_MAINNET_CHAIN_ID` (20 constants) | `ChainKeys.*` (single namespace). See [`type-system.md`](type-system.md) § 1 for the full table. |

### Wallet shims

| v1 export | v2 replacement |
|---|---|
| `CustomProvider` (Hana-wallet window typedecl) | None. Window declaration becomes `unknown` or imports directly from the wallet vendor. The Hana wallet helper lives at `HanaWalletConnector` (importable from `@sodax/sdk`). |

### Error types and guards

| v1 export | v2 replacement |
|---|---|
| `MoneyMarketError<MoneyMarketErrorCode>`, plus `MoneyMarketErrorCode` | `SodaxError<C>` with `feature: 'moneyMarket'`. See [`result-and-errors.md`](result-and-errors.md) § 4 for code crosswalk. |
| `IntentError<IntentErrorCode>`, plus the union | `SodaxError<C>` with `feature: 'swap'`. |
| `StakingError<StakingErrorCode>`, plus the union | `SodaxError<C>` with `feature: 'staking'`. |
| `BridgeError<BridgeErrorCode>`, plus the union | `SodaxError<C>` with `feature: 'bridge'`. |
| `MigrationError<MigrationErrorCode>`, plus the union | `SodaxError<C>` with `feature: 'migration'`. |
| `AssetServiceError<AssetServiceErrorCode>`, plus the union | `SodaxError<C>` with `feature: 'dex'`. |
| `ConcentratedLiquidityError<ConcentratedLiquidityErrorCode>`, plus the union | `SodaxError<C>` with `feature: 'dex'`. |
| `RelayError<RelayErrorCode>`, plus the union | `SodaxError<C>` with relay code on `error.context.relayCode`. |
| `PartnerFeeClaimError<...>` (5 partner errors) | `SodaxError<C>` with `feature: 'partner'`. |
| `isMoneyMarketError`, `isIntentError`, `isStakingError`, `isBridgeError`, `isMigrationError`, `isAssetServiceError`, `isConcentratedLiquidityError`, `isRelayError` (type-guards) | `isSodaxError(e)` + check `e.feature === '<feature>'`, or use `isFeatureError('<feature>')` to build a guard. See [`result-and-errors.md`](result-and-errors.md) § 7. |
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

## Appendix B: `SodaxConfig` constructor reshape

The v2 `Sodax` constructor accepts a `DeepPartial<SodaxConfig>`. Several config fields renamed or moved between v1 and v2; if your project passed a custom config, check these:

| v1 location | v2 location |
|---|---|
| `SodaxConfig.swaps` (held solver endpoints AND supported tokens) | Split into two: `SodaxConfig.swaps` (now `SwapsConfig` — supported tokens per chain) and `SodaxConfig.solver` (`{ intentsContract, solverApiEndpoint, protocolIntentsContract }`). |
| `SodaxConfig.rpcConfig` (flat object: one URL per chain field) | `SodaxConfig.rpcConfig` (mapped type keyed by `ChainKey` values; chain-family-specific shapes — see [`type-system.md`](type-system.md) § 5). |
| `SodaxConfig.hubProviderConfig` | Renamed: `SodaxConfig.hubConfig`. |
| `SodaxConfig.configService` (raw `IConfigApi` instance you injected) | Pass via `new Sodax({ configService: <your impl> })` is gone — `ConfigService` is constructed internally. To inject a custom `IConfigApi`, override via `SodaxConfig.backendApi`. |

Migration:

```diff
  const sodax = new Sodax({
-   swaps: {
-     intentsContract: '0x…',
-     solverApiEndpoint: 'https://…',
-     supportedTokens: { /* … */ },
-   },
+   solver: {
+     intentsContract: '0x…',
+     solverApiEndpoint: 'https://…',
+   },
+   swaps: {
+     supportedTokens: { /* per-chain table */ },
+   },
-   rpcConfig: { sonic: 'https://…', arbitrum: 'https://…' },
+   rpcConfig: {
+     [ChainKeys.SONIC_MAINNET]: 'https://…',
+     [ChainKeys.ARBITRUM_MAINNET]: 'https://…',
+     [ChainKeys.BITCOIN_MAINNET]: { /* BitcoinRpcConfig shape */ },
+     // …
+   },
-   hubProviderConfig: { /* … */ },
+   hubConfig: { /* … */ },
  });
  await sodax.config.initialize();
```

### Pitfall

If you previously injected a custom `ConfigService` for testing (a v1 escape hatch), v2 doesn't accept one at the top level. Inject a custom `IConfigApi` via `SodaxConfig.backendApi.api` instead — `ConfigService` consumes it internally on `initialize()`.

---

## Cross-references

- Type-level renames and shape changes: [`type-system.md`](type-system.md).
- Result/error model semantics: [`result-and-errors.md`](result-and-errors.md).
- v2 design context (architectural concepts): [`../../integration/architecture.md`](../../integration/architecture.md).
- ConfigService usage patterns: [`../../integration/recipes.md`](../../integration/recipes.md) § "Initialize Sodax".
- Public API surface: [`../../integration/reference.md`](../../integration/reference.md) § "Public API surface".
