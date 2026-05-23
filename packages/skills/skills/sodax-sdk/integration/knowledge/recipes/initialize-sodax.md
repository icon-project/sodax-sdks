# Initialize Sodax

The minimal init — packaged defaults, no config override:

```ts
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax();
await sodax.config.initialize();   // load fresh config from backend; falls back to packaged defaults

// All feature services are wired and ready:
const result = sodax.config.isValidSpokeChainKey(ChainKeys.ARBITRUM_MAINNET);   // returns boolean (sync)
```

### With config override

```ts
import { Sodax, ChainKeys, type SodaxConfig, type DeepPartial } from '@sodax/sdk';

const config: DeepPartial<SodaxConfig> = {
  // Per-chain overrides — merged with packaged defaults at the field level.
  chains: {
    [ChainKeys.SONIC_MAINNET]: { rpcUrl: process.env.SONIC_RPC_URL },
    [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: process.env.ARBITRUM_RPC_URL },
  },
  // Backend API override (default: https://api.sodax.com/v1/be).
  api: {
    baseURL: 'https://my-sandbox-backend.example.com',
  },
  // Solver endpoints (default: https://api.sodax.com/v1/intent + production contracts).
  solver: {
    solverApiEndpoint: 'https://my-solver.example.com',
  },
};

const sodax = new Sodax(config);
await sodax.config.initialize();
```

### Lazy initialization

`config.initialize()` is idempotent — calling it twice is a no-op. The first call fetches; subsequent calls return cached data. Treat it as "make sure config is loaded before any feature method".

### Pitfall

`initialize()` is the only initialization step. Don't `await` it inside every feature call — call it once at app startup. If you skip it entirely, feature services fall back to packaged defaults, which may be stale relative to the latest backend config (new tokens, new chains, fee parameter changes).

## Module-scope reads (no Sodax instance needed)

Some code runs at **module-load time** — constants files, utility modules, framework-provider configs — before any `Sodax` instance exists. For those, import the packaged-default constants directly from `@sodax/sdk` (re-exported from `@sodax/types`):

```ts
import { sodaxConfig, hubConfig } from '@sodax/sdk';

// Hub address constants
export const HUB_WALLET = hubConfig.addresses.hubWallet;
export const STAKING_ROUTER = hubConfig.addresses.stakingRouter;

// Full default config (every SodaxConfig field with packaged defaults)
export const DEFAULT_SOLVER_ENDPOINT = sodaxConfig.solver.solverApiEndpoint;
export const SUPPORTED_TOKENS_PER_CHAIN = sodaxConfig.swaps.supportedTokens;
```

| Need | Module-scope import (defaults only) | Instance-scope read (with overrides) |
|---|---|---|
| Hub contract addresses (assetManager, hubWallet, stakingRouter, etc.) | `hubConfig.addresses.*` | `sodax.config.getHubChainConfig().addresses.*` |
| Full default SodaxConfig (read-only snapshot) | `sodaxConfig.*` (e.g. `sodaxConfig.hub`, `sodaxConfig.moneyMarket`) | `sodax.config.sodaxConfig` |
| Per-chain spoke config (rpcUrl, nativeToken, addresses, supportedTokens, polling) | `spokeChainConfig[ChainKeys.X_MAINNET]` (from `@sodax/types` / `@sodax/sdk`) | `sodax.config.spokeChainConfig[ChainKeys.X_MAINNET]` *or* `sodax.config.getChainConfig(ChainKeys.X_MAINNET)` |
| Money market reserve assets | `sodaxConfig.moneyMarket.supportedReserveAssets` | `sodax.config.getMoneyMarketReserveAssets()` |

> **Static vs dynamic — and the override-gap consequence.** `sodaxConfig` / `hubConfig` / `spokeChainConfig` are **packaged-default snapshots** frozen at SDK release time. They are safe at module scope but: (a) won't reflect backend-driven config updates loaded by `sodax.config.initialize()`, and (b) **won't reflect overrides passed to `new Sodax(config)`** — those merge into `sodax.config` (the `ConfigService`) but never mutate the static imports. So once a `Sodax` instance exists, prefer the instance-scope readers in the right column above — particularly `sodax.config.spokeChainConfig` over the same-named static import — or you will silently fall back to the packaged defaults for any chain you customized.


## Cross-references

- [`README.md`](README.md) — recipe index.
- [`../architecture.md`](../architecture.md) — concepts behind these patterns.
- [`../reference/`](../reference/) — chain keys, error codes, public API surface.
