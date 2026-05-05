# Configure SDK

Learn how to configure the Sodax SDK for your application. The SDK supports Swaps (intent-based solver swaps), Money Market (cross-chain lending and borrowing), and many other cross-chain DeFi services. All feature configurations are optional—you can use just the features you need.

## Basic Configuration

### Default Configuration

Initialize the SDK with default Sonic mainnet configurations (no fees):

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax();
```

The constructor signature is `new Sodax(config?: DeepPartial<SodaxConfig>)`. When called with no arguments the SDK uses the packaged static defaults for all chains and tokens.

### Dynamic Configuration

For the latest tokens and chains, call `initialize()` before usage. Without this call the SDK falls back to the static defaults bundled with the installed version:

```typescript
const initResult = await sodax.initialize();
if (!initResult.ok) {
  console.error('Initialization failed:', initResult.error);
}
```

`initialize()` returns `Promise<Result<void>>`. On success, `ConfigService` is populated with up-to-date chain and token data fetched from the backend API. On failure the SDK continues to work with the packaged defaults — the error is informational only.

### Partner Fees

Configure partner fees for swaps and/or money market operations. See [Monetize SDK](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/MONETIZE_SDK.md) for detailed fee configuration options.

```typescript
import { Sodax, PartnerFee } from '@sodax/sdk';

const partnerFee: PartnerFee = {
  address: '0x0000000000000000000000000000000000000000', // address to receive fee
  percentage: 100, // 100 = 1%, 10000 = 100%
};

// Fee on swaps only
const sodaxWithSwapFees = new Sodax({
  swap: { partnerFee },
});

// Fee on money market only
const sodaxWithMoneyMarketFees = new Sodax({
  moneyMarket: { partnerFee },
});

// Fees on both features
const sodaxWithFees = new Sodax({
  swap: { partnerFee },
  moneyMarket: { partnerFee },
});
```

## Custom Configuration

### Partner Fees

Partner fees can be defined as a percentage or a definite token amount:

```typescript
import { PartnerFee } from '@sodax/sdk';

// Percentage-based fee
const partnerFeePercentage: PartnerFee = {
  address: '0x0000000000000000000000000000000000000000',
  percentage: 100, // 100 = 1%, 10000 = 100%
};

// Amount-based fee
const partnerFeeAmount: PartnerFee = {
  address: '0x0000000000000000000000000000000000000000',
  amount: 1000n, // definite amount in token decimal precision
};
```

### Solver Configuration

Solver config is optional and required only for intent-based swaps. You can use a custom config or the default one (based on hub chain key—defaults to Sonic).

```typescript
import {
  Sodax,
  SolverConfigParams,
  getSolverConfig,
  ChainKeys,
} from '@sodax/sdk';

// Custom solver config
const customSolverConfig: SolverConfigParams = {
  intentsContract: '0x6382D6ccD780758C5e8A6123c33ee8F4472F96ef',
  solverApiEndpoint: 'https://sodax-solver-staging.iconblockchain.xyz',
  partnerFee: partnerFeePercentage, // optional
};

// Pre-defined default solver config
const solverConfig = getSolverConfig(ChainKeys.SONIC_MAINNET);

const sodax = new Sodax({
  swap: customSolverConfig
});
```

### Money Market Configuration

Money market config is optional and required only for cross-chain lending and borrowing.

```typescript
import {
  Sodax,
  MoneyMarketConfigParams,
  getMoneyMarketConfig,
  ChainKeys,
} from '@sodax/sdk';

// Custom money market config
const customMoneyMarketConfig: MoneyMarketConfigParams = {
  lendingPool: '0x553434896D39F867761859D0FE7189d2Af70514E',
  uiPoolDataProvider: '0xC04d746C38f1E51C8b3A3E2730250bbAC2F271bf',
  poolAddressesProvider: '0x036aDe0aBAA4c82445Cb7597f2d6d6130C118c7b',
  bnUSD: '0x94dC79ce9C515ba4AE4D195da8E6AB86c69BFc38',
  bnUSDVault: '0xE801CA34E19aBCbFeA12025378D19c4FBE250131',
};

// Pre-defined default money market config
const moneyMarketConfig = getMoneyMarketConfig(ChainKeys.SONIC_MAINNET);

const sodax = new Sodax({
  moneyMarket: customMoneyMarketConfig
});
```

### Hub Provider Configuration

Configure the hub chain provider for cross-chain operations:

```typescript
import {
  EvmHubProviderConfig,
  getHubChainConfig,
  ChainKeys,
} from '@sodax/sdk';

const sodax = new Sodax({
  hubProviderConfig: {
    hubRpcUrl: 'https://rpc.soniclabs.com',
    chainConfig: getHubChainConfig(ChainKeys.SONIC_MAINNET),
  }
});
```

### Shared Configuration

Configure the SDK to use specific RPC endpoints when internally reading from blockchains:

```typescript
import {
  ChainKeys,
} from '@sodax/sdk';

const sodax = new Sodax({
  sharedConfig: { // config used by internal services
    [ChainKeys.STELLAR_MAINNET]: {
      horizonRpcUrl: 'https://horizon.stellar.org',
      sorobanRpcUrl: 'https://rpc.ankr.com/stellar_soroban',
    }
  }
});
```

### Complete Custom Configuration

Combine all configurations:

```typescript
import {
  Sodax,
  getSolverConfig,
  getMoneyMarketConfig,
  getHubChainConfig,
  ChainKeys,
} from '@sodax/sdk';

const sodax = new Sodax({
  swap: getSolverConfig(ChainKeys.SONIC_MAINNET),
  moneyMarket: getMoneyMarketConfig(ChainKeys.SONIC_MAINNET),
  hubProviderConfig: {
    hubRpcUrl: 'https://rpc.soniclabs.com',
    chainConfig: getHubChainConfig(ChainKeys.SONIC_MAINNET),
  },
  sharedConfig: { // config used by internal services
    [ChainKeys.STELLAR_MAINNET]: {
      horizonRpcUrl: 'https://horizon.stellar.org',
      sorobanRpcUrl: 'https://rpc.ankr.com/stellar_soroban',
    }
  }
});

// Optional: fetch latest tokens/chains from backend
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
| `sodax.spokeService` | `SpokeService` | Spoke chain routing facade |
| `sodax.instanceConfig` | `SodaxConfig` | Resolved config passed to the constructor |

## Chain Keys

All chain constants live under `ChainKeys.*` — import them from `@sodax/sdk`:

```typescript
import { ChainKeys } from '@sodax/sdk';

ChainKeys.SONIC_MAINNET
ChainKeys.ETHEREUM_MAINNET
ChainKeys.ARBITRUM_MAINNET
ChainKeys.SOLANA_MAINNET
// … and so on for all 20 supported chains
```

`SpokeChainKey` is the union type of all `ChainKeys` values. Use it to type any parameter that accepts a chain identifier.

## Additional Resources

- [Monetize SDK](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/MONETIZE_SDK.md) - Detailed fee configuration guide
- [Architecture Reference](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/ARCHITECTURE_REFACTOR_SUMMARY.md) - Spoke services, raw tx handling, `Result<T>`, error conventions
