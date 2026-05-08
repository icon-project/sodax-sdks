# Architecture — `@sodax/sdk` v2

Every v2 design concept the SDK rests on, in a single TOC-navigable file. Read end-to-end if you're new to v2; skim by section if you're solving a specific problem.

## Section index

1. [Hub-and-spoke model](#1-hub-and-spoke-model) — Sonic is the hub; 19 spoke chains route through it.
2. [`SpokeService` router](#2-spokeservice-router) — single internal dispatcher; no per-chain provider classes.
3. [`Sodax` facade and service graph](#3-sodax-facade-and-service-graph) — one instance owns every feature service.
4. [`ConfigService`](#4-configservice) — dynamic config from backend with packaged-defaults fallback.
5. [`ChainKeys` and chain-key narrowing](#5-chainkeys-and-chain-key-narrowing) — `GetChainType<K>`, `GetWalletProviderType<K>`.
6. [`WalletProviderSlot<K, Raw>`](#6-walletproviderslotk-raw) — discriminated union for signed vs raw flows.
7. [`Result<T, SodaxError<C>>`](#7-resultt-sodaxerrorc) — every async public method returns this.
8. [`SodaxError<C>` and the 13-code vocabulary](#8-sodaxerrorc-and-the-13-code-vocabulary) — canonical error class.
9. [Relay layer: `relayTxAndWaitPacket` and `mapRelayFailure`](#9-relay-layer-relaytxandwaitpacket-and-mapfailrelay) — cross-chain coordination.

---

## 1. Hub-and-spoke model

SODAX is a cross-chain DeFi platform built on a hub-and-spoke architecture. **Sonic is the hub chain.** Every cross-chain operation flows through it:

```
spoke chain (e.g. Arbitrum)
    │
    │  spoke transaction (deposit / approve / send)
    ▼
SpokeService (in @sodax/sdk)
    │
    │  IntentRelayApiService.submitTransaction
    ▼
relay layer
    │
    │  relayTxAndWaitPacket → packet 'executed' on hub
    ▼
EvmHubProvider
    │
    │  hub-side contracts (vault, asset manager, wallet abstraction)
    ▼
destination spoke (e.g. Stellar)
```

For most consumers, this whole pipeline is one method call (`sodax.swaps.swap(...)`, `sodax.bridge.bridge(...)`, etc.). The result is a `Result<[SpokeTxHash, HubTxHash]>` (or `{ srcChainTxHash, dstChainTxHash }` for money market). The relay state in between is handled internally.

**You will hit "the relay" surface area** when:

- An operation fails partway through and the error is a relay code (`'TX_SUBMIT_FAILED'`, `'RELAY_TIMEOUT'`, `'RELAY_POLLING_FAILED'`) — see § 9.
- You build a custom orchestration on top of `relayTxAndWaitPacket` directly (rare; usually a feature service is the right abstraction).
- You need to recover assets stuck in a hub wallet — use `RecoveryService`.

### Supported chains

20 total. EVM (12): Sonic (hub), Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia. Non-EVM (8): Solana, Sui, Stellar, ICON, Injective, NEAR, Stacks, Bitcoin. See [`reference.md`](reference.md) § "Chain keys" for the full table with relay IDs and address-type mapping.

---

## 2. `SpokeService` router

The SDK does not require callers to construct per-chain provider classes. There is no `EvmSpokeProvider`, `SolanaSpokeProvider`, etc. for consumers to construct.

Instead, the SDK has **one** `SpokeService` instance (owned by `Sodax`) which holds one per-chain-family service internally:

```
SpokeService
 ├── EvmSpokeService        (handles all 12 EVM chains)
 ├── SonicSpokeService      (special-cased for the hub)
 ├── SolanaSpokeService
 ├── SuiSpokeService
 ├── StellarSpokeService
 ├── IconSpokeService
 ├── InjectiveSpokeService
 ├── StacksSpokeService
 ├── BitcoinSpokeService
 └── NearSpokeService
```

Public entry: `sodax.spoke.getSpokeService(chainKey)` (typed). Feature services route to the right family by calling this internally — consumer-side code never does.

### How the router uses chain keys

The chain key on the request payload (e.g. `srcChainKey: ChainKeys.ETHEREUM_MAINNET`) does two things at once:

1. **Type-level narrowing** — TypeScript preserves the literal in the generic `K`. From `K`, the type system derives:
   - `GetChainType<K>` → chain family (`'EVM' | 'BITCOIN' | 'SOLANA' | …`)
   - `GetWalletProviderType<K>` → chain-specific wallet provider interface (`IEvmWalletProvider`, …)
   - `TxReturnType<K, Raw>` → chain-specific tx return shape
2. **Runtime dispatch** — `getChainType(chainKey)` (the runtime helper) resolves the family at runtime, and `SpokeService` calls the right family service.

The chain key is the bridge between the type system and runtime routing.

---

## 3. `Sodax` facade and service graph

The `Sodax` class is the public entry point. It constructs and wires every service once at construction time, then reuses them across calls:

```ts
const sodax = new Sodax(/* optional DeepPartial<SodaxConfig> */);
await sodax.config.initialize();   // fetch dynamic config; fall back to packaged defaults

// All feature services accessed off the instance:
await sodax.swaps.createIntent({ params, raw: false, walletProvider });
await sodax.moneyMarket.supply({ params, raw: false, walletProvider });
await sodax.bridge.bridge({ params, raw: false, walletProvider });
```

### Service graph

```
Sodax
 ├── swaps           — SwapService            (intent-based swaps via solver)
 ├── moneyMarket     — MoneyMarketService     (cross-chain lending/borrowing)
 ├── bridge          — BridgeService          (cross-chain token transfers)
 ├── staking         — StakingService         (SODA/xSoda staking)
 ├── dex             — DexService             (concentrated liquidity, AMM)
 ├── migration       — MigrationService       (ICX/bnUSD/BALN migration)
 ├── partners        — PartnerService         (partner fee claiming)
 ├── recovery        — RecoveryService        (withdraw stuck hub-wallet assets)
 ├── backendApi      — BackendApiService      (intent lookup, swap submission, config fetching)
 ├── config          — ConfigService          (dynamic config; see § 4)
 ├── hubProvider     — HubProvider            (hub contract interactions; concrete impl `EvmHubProvider`)
 └── spoke           — SpokeService           (per-chain-family router; see § 2)
```

All feature services receive `{ hubProvider, config, spoke }` via constructor injection. You don't instantiate them directly — accessing `sodax.<feature>` is the public API.

### Constructor

```ts
import { Sodax, type SodaxConfig, type DeepPartial } from '@sodax/sdk';

new Sodax(config?: DeepPartial<SodaxConfig>): Sodax;
```

`SodaxConfig` carries (all optional via `DeepPartial`):

- `solver` — `{ intentsContract, solverApiEndpoint, protocolIntentsContract }` (endpoints).
- `swaps` — `SwapsConfig` (supported solver tokens per chain).
- `moneyMarket`, `bridge`, `staking`, `dex`, `migration`, `partner`, `recovery` — feature-specific config (contract addresses, etc.).
- `rpcConfig` — mapped type keyed by `ChainKey` values; `BitcoinRpcConfig` for `BITCOIN_MAINNET`, `StellarRpcConfig` for `STELLAR_MAINNET`, RPC URL strings for everything else.
- `hubConfig` — hub provider config (consumed by `EvmHubProvider`).
- `backendApi` — `{ url, api?: IConfigApi }` for custom backend / sandbox endpoints.

In production, the packaged defaults are sufficient — pass nothing and call `await sodax.config.initialize()` to load fresh data from the backend.

---

## 4. `ConfigService`

Replaces every static lookup table that v1 exported as a global (`hubAssets`, `moneyMarketSupportedTokens`, `solverSupportedTokens`, `SodaTokens`, etc.). Loads from the backend API on `initialize()`; falls back to packaged defaults from `@sodax/types` if the backend is unreachable.

### Lifecycle

```ts
const sodax = new Sodax();
await sodax.config.initialize();   // network call + cache; fall back on failure

// After init:
sodax.config.isSupportedChain(chainKey);
sodax.config.findSupportedTokenBySymbol(chainKey, 'USDC');
sodax.config.getSupportedTokensPerChain();
sodax.config.getOriginalAssetAddress(hubAddress);
sodax.config.getMoneyMarketReserveAssets();
sodax.config.getSolverSupportedTokens(chainKey);
sodax.config.getSpokeChainKeyFromIntentRelayChainId(BigInt(...));
```

Every feature service consumes `ConfigService` internally. The data flows through `XToken` (which now carries `vault` and `hubAsset` directly per token) and through service-method wrappers like `sodax.moneyMarket.getSupportedTokens()`.

### Why dynamic

Chain configs (vault addresses, supported tokens, fee parameters) change between SDK releases. Dynamic loading means the SDK can pick up new chains and tokens without a version bump. The packaged defaults are a fallback for offline / sandbox / pre-release conditions.

### Custom backend

Inject a custom `IConfigApi` for testing or sandbox via `SodaxConfig.backendApi.api`. The contract: every method on `IConfigApi` returns `Promise<Result<T>>`.

---

## 5. `ChainKeys` and chain-key narrowing

`ChainKeys` is a `const` object with one string property per chain. The values form the `ChainKey` union (full chain set, including hub) and `SpokeChainKey` (spoke chains only — no hub).

```ts
import { ChainKeys, type ChainKey, type SpokeChainKey } from '@sodax/sdk';

ChainKeys.SONIC_MAINNET            // 'sonic'
ChainKeys.ETHEREUM_MAINNET         // 'ethereum'
ChainKeys.ARBITRUM_MAINNET         // '0xa4b1.arbitrum'
ChainKeys.ICON_MAINNET             // '0x1.icon'
ChainKeys.BITCOIN_MAINNET          // 'bitcoin'
// …
```

The full table with values + chain family + relay id is in [`reference.md`](reference.md) § "Chain keys".

### Narrowing

When a literal `srcChainKey` flows into a generic method, TypeScript preserves it as a value type. From that one literal:

```ts
type K = typeof ChainKeys.ETHEREUM_MAINNET;     // '0xa4b1...' (the literal)

GetChainType<K>           // 'EVM'
GetWalletProviderType<K>  // IEvmWalletProvider
TxReturnType<K, false>    // Hash (the EVM signed-tx return)
TxReturnType<K, true>     // EvmRawTransaction
```

This is what allows `sodax.swaps.createIntent({ params: { srcChainKey: ChainKeys.ETHEREUM_MAINNET, ... }, raw: false, walletProvider: <evm-provider> })` to enforce at compile time that `walletProvider` is `IEvmWalletProvider` and not a Solana or Bitcoin one — there's no runtime check; the type system does it.

### Runtime helpers

```ts
import { getChainType, isEvmChainKeyType, isSolanaChainKeyType, isBitcoinChainKeyType, /* … */ } from '@sodax/sdk';

getChainType(chainKey);        // 'EVM' | 'BITCOIN' | 'SOLANA' | 'STELLAR' | 'SUI' | 'ICON' | 'INJECTIVE' | 'STACKS' | 'NEAR' | 'SONIC'
isEvmChainKeyType(chainKey);   // boolean (with type guard)
```

Use these for runtime branching — the typed helpers are friendlier than ad-hoc string equality and they don't go stale when new chains are added (they consult the central registry).

---

## 6. `WalletProviderSlot<K, Raw>`

The discriminated union that distinguishes signed-execution from raw-tx-building at compile time.

```ts
type WalletProviderSlot<K extends ChainKey, Raw extends boolean> =
  Raw extends true
    ? { raw: true; walletProvider?: never }
    : { raw: false; walletProvider: GetWalletProviderType<K> };
```

### Three rules

1. **`raw: true`** — `walletProvider` is **forbidden** (`?: never` rejects any value). The method returns a raw, unsigned tx payload (`TxReturnType<K, true>` — `EvmRawTransaction`, `SolanaRawTransaction`, etc.).
2. **`raw: false`** — `walletProvider` is **required** and chain-narrowed via `GetWalletProviderType<K>`. The method signs and broadcasts; returns a tx hash (`TxReturnType<K, false>`).
3. **Mandatory discriminator** — without `raw: true` or `raw: false` in the literal, TypeScript can't pick a branch. Forgetting the discriminator surfaces as: `Object literal may only specify known properties, and 'walletProvider' does not exist in type ...`.

### Usage in service methods

Every signed-execution method accepts `WalletProviderSlot<K, false>` (intersected into the action params type). Every raw-tx-building method accepts `WalletProviderSlot<K, true>` (sometimes both, via the `Raw extends boolean` generic).

```ts
// Signed:
sodax.swaps.createIntent({ params, raw: false, walletProvider });

// Raw:
sodax.swaps.createIntent({ params, raw: true });

// Compile errors:
sodax.swaps.createIntent({ params, walletProvider });          // missing 'raw'
sodax.swaps.createIntent({ params, raw: true, walletProvider }); // walletProvider forbidden when raw: true
sodax.swaps.createIntent({ params, raw: false });              // walletProvider required when raw: false
```

### When to pick which

- **`raw: false`** — your app holds the wallet (Node script with private key, browser dApp with extension). Default for most flows.
- **`raw: true`** — your app builds the tx but a different system signs it (gnosis safe, hardware wallet across an isolation boundary, custom multi-sig). The returned payload is chain-specific; submit it via your own signing infra.

### Read-only methods

Some read-only methods (`isAllowanceValid`, `getDeposit`) intersect with `WalletProviderSlot<K, Raw>` even though they don't actually consult the wallet provider. The underlying read doesn't need a wallet — but the method signature is unified with write methods. Use `{ params, raw: true }` for these; no wallet provider needed:

```ts
const result = await sodax.dex.assetService.isAllowanceValid({ params, raw: true });
```

---

## 7. `Result<T, SodaxError<C>>`

Every async public method returns this. There is no `throw` across a service boundary in v2.

### Shape

```ts
type Result<T, E = Error | unknown> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

Defined in `@sodax/types`, re-exported from `@sodax/sdk`.

### Branching

```ts
const result = await sodax.swaps.createIntent({ params, raw: false, walletProvider });
if (!result.ok) {
  // result.error: SodaxError<C> for the narrow code union of createIntent
  return;
}
const { tx, intent, relayData } = result.value;
```

### Sub-Result propagation

Inside SDK code (and useful for consumer wrappers):

```ts
async function myWorkflow(): Promise<Result<MyOutput, SodaxError<MyCodes>>> {
  const sub = await this.subOperation();
  if (!sub.ok) return sub;   // forward as-is; narrower code unions are structurally assignable

  // success path
  return { ok: true, value: /* … */ };
}
```

Narrower code unions (e.g. `'INTENT_CREATION_FAILED' | 'VALIDATION_FAILED'`) are structurally assignable to wider unions, so forwarding a sub-Result without re-wrapping typechecks.

### No helpers like `toResult` / `tryCatch`

There's no `safeCall` wrapper. Explicit `try/catch` at each public method boundary is the deliberate convention — see `packages/sdk/CLAUDE.md` (internal) for the full pattern. Consumer-side code does the same: branch on `result.ok` and let success and failure paths diverge cleanly.

### Pitfall

A `try { await sodax.<method>(...) } catch` block does **not** catch `Result` `{ ok: false }` — the SDK doesn't throw. The `catch` only fires for synchronous wrapper exceptions (e.g. missing `walletProvider`). Always branch on `result.ok`.

---

## 8. `SodaxError<C>` and the 13-code vocabulary

The canonical error class. Every SDK-emitted error is a `SodaxError<C>` parameterised by a code from a closed 13-element union.

### Shape

```ts
class SodaxError<C extends SodaxErrorCode = SodaxErrorCode> extends Error {
  readonly code: C;                 // closed 13-code reason union
  readonly feature: SodaxFeature;   // 'swap' | 'moneyMarket' | 'bridge' | 'staking' | 'migration' | 'dex' | 'partner' | 'recovery'
  readonly cause?: unknown;
  readonly context?: SodaxErrorContext;

  toJSON(): SodaxErrorJSON<C>;      // canonical logger surface
}
```

### The 13 codes

| Code | Meaning |
|---|---|
| `VALIDATION_FAILED` | Pre-flight invariant tripped. |
| `INTENT_CREATION_FAILED` | Building the intent / payload failed. |
| `EXECUTION_FAILED` | Orchestrator-level catch-all for multi-step ops. |
| `TX_VERIFICATION_FAILED` | Spoke-side `verifyTxHash` returned false / threw. |
| `TX_SUBMIT_FAILED` | Spoke tx landed; relay POST submit failed. |
| `RELAY_TIMEOUT` | Destination packet didn't reach `executed` within timeout. |
| `RELAY_FAILED` | Relay polling outage / unrecognised relay error. |
| `APPROVE_FAILED` | Token approval call failed. |
| `ALLOWANCE_CHECK_FAILED` | Reading on-chain allowance failed. |
| `GAS_ESTIMATION_FAILED` | Gas estimation returned an error. |
| `LOOKUP_FAILED` | Read-only on-chain query / off-chain config fetch. |
| `EXTERNAL_API_ERROR` | Upstream API call failed (solver, backend). |
| `UNKNOWN` | Last-resort catch in an outer `try`. Should be rare. |

The full per-code semantics, common context fields, per-feature narrow unions, and retry guidance are in [`reference.md`](reference.md) § "Error codes".

### `(feature, code)` discrimination

The pair `(error.feature, error.code)` is the canonical discriminator. Use it for both logging tags and switch statements:

```ts
import { isSodaxError } from '@sodax/sdk';

if (!result.ok && isSodaxError(result.error)) {
  if (result.error.feature === 'moneyMarket' && result.error.code === 'INTENT_CREATION_FAILED') {
    /* show "couldn't build supply" */
  }
  if (result.error.code === 'RELAY_TIMEOUT') {
    /* retry */
  }
}
```

### Per-method narrow unions

Public methods declare narrow code unions via `Extract<SodaxErrorCode, ...>`:

```ts
type CreateSupplyIntentErrorCode = Extract<
  SodaxErrorCode,
  'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN'
>;
```

Switch exhaustively over the narrow union when you know which method emitted the error. The full per-method catalogue is in [`reference.md`](reference.md) § "Per-method error codes".

### Context fields

The `error.context` field carries per-error metadata. Reserved keys:

| Key | Type | Used by |
|---|---|---|
| `action` | string | Discriminates user-facing operation (e.g. `'supply'`, `'stake'`, `'migrateBaln'`). |
| `phase` | `SodaxPhase` | Orchestration phase (`'validate'`, `'intentCreation'`, `'verify'`, `'submit'`, `'relay'`, `'destinationExecution'`, `'execution'`, `'postExecution'`, `'approve'`, `'allowanceCheck'`, `'gasEstimation'`, `'lookup'`). |
| `srcChainKey`, `dstChainKey` | `ChainKey` strings | Chain-related errors. |
| `relayCode` | `'SUBMIT_TX_FAILED' \| 'RELAY_TIMEOUT' \| 'RELAY_POLLING_FAILED' \| 'UNKNOWN'` | Relay-layer errors (mirror of the lower-level relay code). |
| `api` | `'solver' \| 'backend'` | `EXTERNAL_API_ERROR` only. |
| `method` | string | `LOOKUP_FAILED` only. Names the failing read method. |
| `direction` | `'forward' \| 'reverse'` | Migration's `migratebnUSD` only. |
| `field`, `reason` | string | `VALIDATION_FAILED`. Names the precondition that tripped. |
| `[key: string]` | unknown | Open at the index signature for feature-specific metadata. |

### `toJSON()` and logger integration

`JSON.stringify(error)` calls `toJSON()` automatically. The serializer:

- Coerces `bigint` to string anywhere in `context`.
- Walks `cause` chains up to depth 3.
- Stringifies `Date`, `Map`, `Set`, `Error`, and class instances safely.
- Bounds depth at 5 to prevent cycles.

Consumer-side:

```ts
// Sentry
Sentry.captureException(err, {
  tags: { feature: err.feature, code: err.code, action: err.context?.action },
});

// Pino
logger.error({ err }, 'sodax operation failed');
```

### `isSodaxError` (preferred over `instanceof`)

```ts
import { isSodaxError, isFeatureError } from '@sodax/sdk';

if (isSodaxError(e)) {
  // e: SodaxError<SodaxErrorCode>
}

const isSwapError = isFeatureError('swap');
if (isSwapError(e)) {
  // e: SodaxError with feature: 'swap'
}
```

Use these in cross-bundle code (Next.js apps, ESM/CJS interop, monorepos). `instanceof SodaxError` returns `false` when `@sodax/sdk` is loaded twice in the same bundle — `isSodaxError` walks structural shape and works regardless.

---

## 9. Relay layer: `relayTxAndWaitPacket` and `mapRelayFailure`

Cross-chain coordination is centralised in `IntentRelayApiService`, an internal SDK service. Two entry points the feature services use under the hood:

- `submitTransaction({ srcChainKey, txHash, payload })` — POSTs the spoke transaction to the relay submit endpoint and resolves the relay's first-stage acknowledgement.
- `relayTxAndWaitPacket({ srcChainKey, dstChainKey, txHash, payload, timeout? })` — runs `submitTransaction` and then polls until the destination packet reaches `executed`.

`IntentRelayApiService` is **not** exposed on the `Sodax` instance. Consumers do not call it directly — every feature service (`swaps.swap`, `bridge.bridge`, `staking.stake`, …) wraps the spoke→hub leg internally. If you genuinely need custom relay orchestration (rare), import the class from `@sodax/sdk` and instantiate it with the same `relayerApiEndpoint` your `Sodax` instance uses.

### Relay-layer error contract

The relay layer keeps a stable string vocabulary of its own (separate from the 13 `SodaxErrorCode`s):

```ts
type RelayCode =
  | 'SUBMIT_TX_FAILED'      // POST to relay submit endpoint failed
  | 'RELAY_TIMEOUT'         // Poll loop exhausted timeout
  | 'RELAY_POLLING_FAILED'  // Relay endpoint outage / unrecognised response
  | 'UNKNOWN';              // Anything else
```

These codes appear on `error.context.relayCode` of the `SodaxError` that surfaces to consumers.

### `mapRelayFailure`

The single shared mapper from a relay-layer error to a `SodaxError`. Every feature service uses it internally — exported for custom orchestration:

```ts
import { mapRelayFailure, IntentRelayApiService } from '@sodax/sdk';

const relayApi = new IntentRelayApiService(/* relayerApiEndpoint */);

try {
  await relayApi.relayTxAndWaitPacket({ /* … */ });
} catch (e) {
  const sodaxError = mapRelayFailure(e, {
    feature: 'swap',
    action: 'createIntent',
    srcChainKey,
    dstChainKey,
    // phase: 'destinationExecution',  // optional override; used by migration's bnUSD secondary watcher
  });
  return { ok: false, error: sodaxError };
}
```

Maps to one of: `'TX_SUBMIT_FAILED'`, `'RELAY_TIMEOUT'`, `'RELAY_FAILED'`, or `'EXECUTION_FAILED'`.

### When to use the relay layer directly

Almost never. The right abstraction is a feature service — `sodax.swaps.swap(...)`, `sodax.bridge.bridge(...)`, `sodax.staking.stake(...)` — which internally builds the spoke tx, calls `relayTxAndWaitPacket`, runs hub-side post-execution, and returns the unified `Result<[SpokeTxHash, HubTxHash]>`.

You drop down to the relay layer only when:

- You're building custom orchestration not represented by a feature service.
- You're testing relay behavior (E2E test that intentionally drops the destination tx).
- You're writing a custom feature on top of the SDK primitives.

### Cross-references

- `RecoveryService` for pulling stuck hub-wallet assets back to a spoke chain: see [`features/auxiliary-services.md`](features/auxiliary-services.md).
- Per-feature error codes related to relay (e.g. `'TX_SUBMIT_FAILED'`, `'RELAY_TIMEOUT'`): [`reference.md`](reference.md) § "Error codes".

---

## Cross-references

- Quickstart (Node + Next.js setup): [`quickstart.md`](quickstart.md).
- Lookup tables (chain keys, error codes, public API surface): [`reference.md`](reference.md).
- Recipes (init, result handling, raw vs signed, narrowing, testing): [`recipes.md`](recipes.md).
- Per-feature usage: [`features/`](features/).
- Non-EVM chain quirks: [`chain-specifics.md`](chain-specifics.md).
- v1 → v2 porting context: [`../migration/README.md`](../migration/README.md).
