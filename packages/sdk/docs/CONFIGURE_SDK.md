# Configure SDK

Learn how to configure the Sodax SDK for your application. The SDK supports Swaps (intent-based solver swaps), Money Market (cross-chain lending and borrowing), and many other cross-chain DeFi services. All feature configurations are optional—you can use just the features you need.

`new Sodax(...)` accepts [`SodaxOptions`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/sodax-config/sodax-config.ts) — a deep-partial override of the static [`SodaxDefaultConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/sodax-config/sodax-config.ts) data shape plus client-side options (`logger`, global `fee`, and per-feature `partnerFee` options). The merged result is [`SodaxConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/sodax-config/sodax-config.ts) (exposed as `sodax.instanceConfig`). All three live in `@sodax/types` and are re-exported from `@sodax/sdk`.

## Basic Configuration

### Default Configuration

Initialize the SDK with default Sonic mainnet configurations (no fees):

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax();
```

The constructor signature is `new Sodax(config?: SodaxOptions)`, where `SodaxOptions = DeepPartial<SodaxDefaultConfig> & SodaxOptionalConfig` — a deep-partial override of the `SodaxDefaultConfig` data contract plus the client-side options: the `logger` sink (see [LOGGING.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/LOGGING.md)), the global partner `fee`, per-feature `partnerFee` options, and the client-side `swapsOptions` / `bridgeOptions` toggles (see [Backend submit-tx 2-step](#backend-submit-tx-2-step-swapsoptionsusebackendsubmittx)). The `logger`, global `fee`, and the `swapsOptions` / `bridgeOptions` toggles are kept off the data contract: they are resolved once and never fetched from or overwritten by the backend config. When called with no arguments the SDK merges your overrides with the packaged static defaults ([`sodaxConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/sodax-config/sodax-config.ts)) using a recursive `deepMerge`. Omitted keys keep their default values.

### Dynamic Configuration

For the latest tokens and chains, call `initialize()` before usage. Without this call the SDK falls back to the static defaults bundled with the installed version:

```typescript
const initResult = await sodax.initialize();
if (!initResult.ok) {
  console.error('Initialization failed:', initResult.error);
}
```

`initialize()` returns `Promise<Result<void>>`. On success, `ConfigService` is populated with up-to-date chain and token data fetched from the backend API. On failure the SDK continues to work with the packaged defaults — the error is informational only.

## SodaxConfig overview

Top-level data keys (the `SodaxDefaultConfig` shape carried inside `SodaxConfig`):

| Key | Type (summary) | Role |
|-----|----------------|------|
| `chains` | `Record<SpokeChainKey, SpokeChainConfig>` | Per-spoke chain addresses, tokens, RPC settings, polling. |
| `swaps` | `SwapsConfig` | Per-chain solver-supported token lists, plus an optional per-feature `partnerFee`. |
| `moneyMarket` | `MoneyMarketConfig` | Lending pool addresses, reserve assets, supported tokens, plus an optional per-feature `partnerFee`. |
| `bridge` | `BridgeConfig` | Optional bridge per-feature `partnerFee`. |
| `dex` | `DexConfig` | Concentrated liquidity contract set and pool keys (Sonic hub). |
| `leverageYield` | `LeverageYieldConfig` | Registry of leverage-yield ERC-4626 vaults on the hub, plus an optional per-feature `partnerFee`. |
| `hub` | `HubConfig` | Hub chain (Sonic) metadata, contract addresses, and `rpcUrl` used by `EvmHubProvider`. |
| `api` | `ApiConfig` | Backend API config — flat `BaseApiConfig` (`{ baseURL, timeout, headers }`, shared by `sodax.api.swaps`) or `CustomApiConfig` to point swaps at its own endpoint. |
| `solver` | `SolverConfig` | Intents contract addresses and solver HTTP API endpoint. |
| `relay` | `RelayConfig` | Relayer HTTP endpoint and spoke-to-intent relay chain ID map. |

The global partner `fee` is **not** a data key — it is a `SodaxOptions` client-side option (like `logger`). Set it via `new Sodax({ fee })` and read the resolved value back on `sodax.config.fee`. It is the default applied to any feature whose own `partnerFee` is unset (see [Partner Fees](#partner-fees)).

### Partner Fees

Set a global `fee` once, override it per feature, or both. The effective fee for a feature is `featureFee ?? fee` — a feature's own `partnerFee` wins, otherwise the global `fee` applies. Services read the resolved value through `ConfigService` getters: `SwapService` reads `config.swapPartnerFee`, `MoneyMarketService` reads `config.moneyMarketPartnerFee`, `BridgeService` reads `config.bridgePartnerFee`, and `LeverageYieldService` reads `config.leverageYieldPartnerFee`. See [Monetize SDK](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/MONETIZE_SDK.md) for usage details and per-request overrides.

```typescript
import { Sodax, PartnerFee } from '@sodax/sdk';

const partnerFee: PartnerFee = {
  address: '0x0000000000000000000000000000000000000000',
  percentage: 100, // basis points: 100 = 1%, 10_000 = 100%
};

// Global fee applied to every feature that has no per-feature override
const sodaxWithGlobalFee = new Sodax({ fee: partnerFee });
```

```typescript
import { Sodax, PartnerFee } from '@sodax/sdk';

const partnerFee: PartnerFee = {
  address: '0x0000000000000000000000000000000000000000', // fee recipient (hub / EVM address)
  percentage: 100, // basis points: 100 = 1%, 10_000 = 100%
};

// Fee on swaps only
const sodaxWithSwapFees = new Sodax({
  swaps: { partnerFee },
});

// Fee on money market only
const sodaxWithMoneyMarketFees = new Sodax({
  moneyMarket: { partnerFee },
});

// Fee on bridge only
const sodaxWithBridgeFees = new Sodax({
  bridge: { partnerFee },
});

// Fees on multiple features
const sodaxWithFees = new Sodax({
  swaps: { partnerFee },
  moneyMarket: { partnerFee },
  bridge: { partnerFee },
});
```

### Partner fee shapes

Partner fees are either percentage-based or amount-based (`PartnerFee` is a discriminated union—use one shape per fee object).

```typescript
import { PartnerFee } from '@sodax/sdk';

const partnerFeePercentage: PartnerFee = {
  address: '0x0000000000000000000000000000000000000000',
  percentage: 100, // basis points: 100 = 1%, 10_000 = 100%
};

const partnerFeeAmount: PartnerFee = {
  address: '0x0000000000000000000000000000000000000000',
  amount: 1000n, // fixed amount in token base units (decimals of the token being charged)
};
```

## Custom configuration

### Solver (`solver`)

Intent-based swaps use the top-level **`solver`** block (not nested under `swaps`). Defaults match [`solverConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/common/constants.ts) in `@sodax/types`.

```typescript
import { Sodax, getSolverConfig, type SolverConfig } from '@sodax/sdk';

// Packaged defaults: omit `solver` on `new Sodax()`, or pass `getSolverConfig()` explicitly (same object as `solverConfig`)
new Sodax({ solver: getSolverConfig() });

const customSolver: SolverConfig = {
  intentsContract: '0x6382D6ccD780758C5e8A6123c33ee8F4472F96ef',
  solverApiEndpoint: 'https://api.sodax.com/v1/intent',
  protocolIntentsContract: '0xaFf2EDb3057ed6f9C1dA6c930b8ddDf2beE573A5',
};

const sodax = new Sodax({ solver: customSolver });
```

`getSolverConfig()` takes no parameters and returns the same object as the exported `solverConfig` constant from `@sodax/sdk`.

Partner fees for swaps belong in **`swaps.partnerFee`**, not inside `solver`.

### Swaps token lists (`swaps.supportedTokens`)

`SwapsConfig` includes `supportedTokens: Record<SpokeChainKey, readonly XToken[]>`. Normally you rely on the packaged lists. If you override them, remember that **`deepMerge` replaces arrays wholesale**—provide the full list for any chain you touch, or omit `supportedTokens` to keep defaults.

### Backend submit-tx 2-step (`swapsOptions.useBackendSubmitTx`)

`swapsOptions` is a **client-side runtime option** on `SodaxOptions` (like `logger`) — it is NOT part of the backend-fetched `SodaxConfig`. Setting `useBackendSubmitTx: true` opts `sodax.swaps.swap()` into a backend-driven **2-step flow**: after the intent tx is created + verified on the source chain, the SDK hands it to the backend swaps API (`sodax.api.swaps.submitTx`), which relays and post-executes server-side; the SDK polls submit-tx status and returns the same `SwapResponse`.

```typescript
const sodax = new Sodax({ swapsOptions: { useBackendSubmitTx: true } });
```

If the backend path does not reach `solved` for **any** reason (submission rejected, terminal `failed`/abandoned status, or poll timeout), `swap()` automatically falls back to the fully client-side relay + post-execution so the swap still completes — **safely**, because re-relaying / re-posting an already-processed swap is idempotent (no double-fill; verified by `e2e-tests/e2e-relay.test.ts`), and the backend poll + fallback share one `timeout` budget (total latency ≤ one `timeout`). Default is `false`. See [SWAPS.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md#backend-2-step-submit-opt-in) for the flow.

### Backend submit-tx (`bridgeOptions.useBackendSubmitTx`)

`bridgeOptions` is the bridge counterpart of `swapsOptions` — a **client-side runtime option** on `SodaxOptions`, distinct from the data `bridge` (partner-fee) slot. Setting `useBackendSubmitTx: true` opts `sodax.bridge.bridge()` into routing the spoke-deposit through the backend bridge API (`sodax.api.bridge.submitTx`), which relays server-side; the SDK polls submit-tx status and returns the same `TxHashPair`.

```typescript
const sodax = new Sodax({ bridgeOptions: { useBackendSubmitTx: true } });
```

On any non-success (submission rejected, terminal `failed`/abandoned, or poll timeout) `bridge()` falls back to the client-side `relayTxAndWaitPacket` flow so the bridge still completes — safe because re-relaying an already-relayed bridge tx is idempotent, and the poll + fallback share one `timeout` budget. Bridge has no solver post-execution, so unlike swaps there is no `'posting_execution'` step. Default is `false`. See [BRIDGE_API.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/BRIDGE_API.md) for the API client.

### Money market (`moneyMarket`)

`MoneyMarketConfig` includes `lendingPool`, `uiPoolDataProvider`, `poolAddressesProvider`, `bnUSD`, `bnUSDVault`, `bnUSDAToken`, `supportedTokens`, `supportedReserveAssets`, and `partnerFee`. The packaged default is [`moneyMarketConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/moneyMarket/moneyMarket.ts).

```typescript
import { Sodax, moneyMarketConfig, type MoneyMarketConfig } from '@sodax/sdk';

// Start from defaults and override specific fields
const sodax = new Sodax({
  moneyMarket: {
    ...moneyMarketConfig,
    lendingPool: '0x553434896D39F867761859D0FE7189d2Af70514E',
    partnerFee: {
      address: '0x0000000000000000000000000000000000000000',
      percentage: 50,
    },
  } satisfies MoneyMarketConfig,
});
```

### Hub (`hub`)

The hub is a single **`HubConfig`**: chain metadata, hub contract addresses, and **`rpcUrl`** used when creating the hub JSON-RPC client. Override RPC or addresses with a partial under `hub`:

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax({
  hub: {
    rpcUrl: 'https://rpc.soniclabs.com',
  },
});
```

After construction, the merged hub is **`sodax.instanceConfig.hub`** (and `sodax.hubProvider.chainConfig`). **`sodax.config.getHubChainConfig()`** returns the static packaged hub snapshot, not the merged instance config—if you customize `hub`, treat `instanceConfig.hub` as the source of truth for your overrides.

### Per-chain RPC and endpoints (`chains`)

There is no separate `sharedConfig`. Spoke RPC URLs and chain-specific settings live on each entry in **`chains[SpokeChainKey]`**. Partial objects are merged into the defaults for that key:

```typescript
import { Sodax, ChainKeys } from '@sodax/sdk';

const sodax = new Sodax({
  chains: {
    [ChainKeys.STELLAR_MAINNET]: {
      horizonRpcUrl: 'https://horizon.stellar.org',
      sorobanRpcUrl: 'https://rpc.ankr.com/stellar_soroban',
    },
  },
});
```

EVM spokes use `rpcUrl` on their spoke config; Stellar uses `horizonRpcUrl` and `sorobanRpcUrl`; Bitcoin includes `radfi` and related fields—mirror the shape of the default `SpokeChainConfig` for the chain you change.

### Backend API (`api`)

[`ApiConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/common/constants.ts) controls `baseURL`, `timeout`, and `headers` for `BackendApiService` (used by `ConfigService` and `initialize()`). It is either a flat `BaseApiConfig` (shown below — shared by `sodax.backendApi`, the swaps client `sodax.api.swaps`, and the bridge client `sodax.api.bridge`) or a nested `CustomApiConfig` (`{ baseApiConfig?, swapsApiConfig?, sponsoringApiConfig? }`) to point an individual client at its own endpoint.

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax({
  api: {
    baseURL: 'https://api.sodax.com/v1/be',
    timeout: 30_000,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  },
});
```

**Which slice moves which client.** The flat fields layer underneath every per-service slice, so a top-level `baseURL` moves all of them at once:

| Client | Resolved from | Notes |
|---|---|---|
| `sodax.backendApi` | flat fields → `baseApiConfig` | |
| `sodax.api.swaps` | flat fields → `baseApiConfig` → `swapsApiConfig` | Only client a `swapsApiConfig` slice affects. |
| `sodax.api.bridge` | flat fields → `baseApiConfig` | Served as `/bridge/*` sub-paths on the base host. Defaults to the same host as swaps, but a `swapsApiConfig` slice does **not** move it — there is no `bridgeApiConfig` slice. |
| `sodax.api.sponsoring` | `sponsoringApiConfig` (own origin; only `timeout` inherits) | Base URL and headers never inherit, so base credentials can't leak to another origin. |

Every client method also takes a per-call `RequestOverrideConfig` (`{ baseURL?, timeout?, headers? }`) as its last argument, which wins over the resolved config — useful for pointing one call at a canary host without touching app-wide config. Note that a `timeout` override **replaces** the resolved value rather than capping it.

### Relayer (`relay`)

[`RelayConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/common/constants.ts) sets `relayerApiEndpoint` and **`relayChainIdMap`** (mapping each `SpokeChainKey` to the hub intent-relay bigint ID). Override only when pointing at a different relayer or custom map.

### DEX (`dex`)

[`DexConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/dex/dex.ts) holds concentrated-liquidity addresses and pool keys for Sonic. Most integrations keep the packaged [`dexConfig`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/dex/dex.ts) default.

### Complete custom configuration

Combine the pieces that matter for your deployment:

```typescript
import {
  Sodax,
  ChainKeys,
  getSolverConfig,
  moneyMarketConfig,
  type PartnerFee,
} from '@sodax/sdk';

const partnerFee = {
  address: '0x0000000000000000000000000000000000000000',
  percentage: 10,
} satisfies PartnerFee;

const sodax = new Sodax({
  solver: getSolverConfig(),
  swaps: { partnerFee },
  moneyMarket: { ...moneyMarketConfig, partnerFee },
  bridge: { partnerFee },
  hub: { rpcUrl: 'https://rpc.soniclabs.com' },
  chains: {
    [ChainKeys.STELLAR_MAINNET]: {
      horizonRpcUrl: 'https://horizon.stellar.org',
      sorobanRpcUrl: 'https://rpc.ankr.com/stellar_soroban',
    },
  },
});

const initResult = await sodax.initialize();
if (!initResult.ok) {
  console.error('Initialization failed:', initResult.error);
}
```

## Service Properties

After construction, the `Sodax` instance exposes the following read-only service properties:

| Property | Type | Description |
|----------|------|-------------|
| `sodax.swaps` | `SwapService` | Intent-based swaps via solver |
| `sodax.moneyMarket` | `MoneyMarketService` | Cross-chain lending and borrowing |
| `sodax.bridge` | `BridgeService` | Cross-chain token transfers |
| `sodax.staking` | `StakingService` | SODA token staking operations |
| `sodax.dex` | `DexService` | Concentrated liquidity / AMM |
| `sodax.migration` | `MigrationService` | ICX / bnUSD / BALN token migration |
| `sodax.partners` | `PartnerService` | Partner fee claiming and operations |
| `sodax.recovery` | `RecoveryService` | Withdraw stuck hub-wallet assets to a spoke chain |
| `sodax.backendApi` | `BackendApiService` | Raw backend API access |
| `sodax.config` | `ConfigService` | Chain/token config and lookup helpers |
| `sodax.hubProvider` | `EvmHubProvider` | Hub chain (Sonic) contract interactions |
| `sodax.spoke` | `SpokeService` | Spoke chain routing facade |
| `sodax.instanceConfig` | `SodaxConfig` | Resolved config after merging with defaults |

## Chain Keys

All chain constants live under `ChainKeys.*` — import them from `@sodax/sdk`:

```typescript
import { ChainKeys } from '@sodax/sdk';

ChainKeys.SONIC_MAINNET;
ChainKeys.ETHEREUM_MAINNET;
ChainKeys.ARBITRUM_MAINNET;
ChainKeys.SOLANA_MAINNET;
// … and so on for all 20 supported chains
```

`SpokeChainKey` is the union type of all `ChainKeys` values. Use it to type any parameter that accepts a chain identifier.

## Additional Resources

- [Monetize SDK](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/MONETIZE_SDK.md) - Detailed fee configuration guide
- [Architecture Reference](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/ARCHITECTURE_REFACTOR_SUMMARY.md) - Spoke services, raw tx handling, `Result<T>`, error conventions
