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

| Need | Module-scope import |
|---|---|
| Hub contract addresses (assetManager, hubWallet, stakingRouter, etc.) | `hubConfig.addresses.*` |
| Full default SodaxConfig (read-only snapshot) | `sodaxConfig.*` (e.g. `sodaxConfig.hub`, `sodaxConfig.moneyMarket`) |
| Per-chain config (rpcUrl, polling, chain-specifics) | `sodaxConfig.chains[ChainKeys.X_MAINNET]` |
| Money market reserve assets | `sodaxConfig.moneyMarket.supportedReserveAssets` |

> **Static vs dynamic.** `sodaxConfig` / `hubConfig` are **packaged-default snapshots** frozen at SDK release time. They are safe at module scope but won't reflect backend-driven config updates. Once a `Sodax` instance exists and `initialize()` has resolved, prefer `sodax.config.*` for runtime-live data (`sodax.config.getHubChainConfig()`, `sodax.config.getMoneyMarketReserveAssets()`, etc.).


## Cross-references

- [`README.md`](README.md) — recipe index.
- [`../architecture.md`](../architecture.md) — concepts behind these patterns.
- [`../reference/`](../reference/) — chain keys, error codes, public API surface.
