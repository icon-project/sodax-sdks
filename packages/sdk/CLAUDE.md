# packages/sdk

Core SDK implementing all SODAX DeFi operations. Entry point: the `Sodax` class in `src/shared/entities/Sodax.ts`.

**This package works standalone** — no React, no wallet-sdk, no dapp-kit required. Backend partners (API servers, bots, scripts) use `@sodax/sdk` directly with a private-key wallet provider and call services. Frontend partners use `@sodax/dapp-kit` which wraps this SDK in React hooks — see `packages/dapp-kit/skills/` for frontend scaffolding guides.

## Architecture

### Hub-and-Spoke Model

Sonic is the hub chain. All cross-chain operations flow through it.

- `EvmHubProvider` (`src/shared/entities/EvmHubProvider.ts`) — interacts with hub contracts (vault tokens, asset manager, wallet abstraction)
- `SpokeService` (`src/shared/services/spoke/SpokeService.ts`) — routing facade that owns one per-chain-family service (`EvmSpokeService`, `SolanaSpokeService`, …) and exposes a typed `getSpokeService(chainKey)` router
- `IntentRelayApiService` (`src/shared/services/intentRelay/`) — relays user actions between hub and spoke chains

### Sodax Facade

`Sodax` class (`src/shared/entities/Sodax.ts`) is the main entry point. It instantiates all services with shared dependencies:

```
Sodax
 ├── swaps: SwapService          (intent-based swaps via solver)
 ├── moneyMarket: MoneyMarketService  (cross-chain lending/borrowing)
 ├── bridge: BridgeService       (cross-chain token transfers)
 ├── staking: StakingService     (SODA token staking)
 ├── dex: DexService             (concentrated liquidity, AMM)
 ├── migration: MigrationService (ICX/bnUSD/BALN migration)
 ├── partners: PartnerService    (partner fee claiming)
 ├── recovery: RecoveryService   (withdraw stuck hub-wallet assets back to a spoke chain)
 ├── backendApi: BackendApiService
 ├── config: ConfigService       (dynamic config from backend API, falls back to defaults)
 ├── hubProvider: EvmHubProvider
 └── spokeService: SpokeService
```

All feature services receive `{ hubProvider, config, spoke }` via constructor injection.

### Configuration

`ConfigService` (`src/shared/config/ConfigService.ts`) fetches chain configs dynamically from the backend API. If the API is unreachable, it falls back to static defaults from `@sodax/types`. This means chain configs can change without SDK releases.

## Directory Structure

```
src/
├── index.ts                 # Barrel export (re-exports all modules + @sodax/types)
├── shared/                  # Core foundation
│   ├── entities/            # Sodax class + hub provider + chain-specific utilities
│   │   ├── Sodax.ts         # Main SDK facade
│   │   ├── EvmHubProvider.ts
│   │   ├── solana/          # PDA utilities, address derivation
│   │   ├── stellar/         # CustomSorobanServer
│   │   ├── icon/            # HanaWalletConnector (browser extension helper)
│   │   ├── injective/       # Injective20Token helper
│   │   └── btc/             # RadfiProvider + btc-utils
│   ├── services/
│   │   ├── hub/             # Hub chain services (asset manager, vault tokens, wallet abstraction)
│   │   ├── spoke/           # Per-chain spoke services (EvmSpokeService, SolanaSpokeService, etc.)
│   │   ├── intentRelay/     # IntentRelayApiService
│   │   ├── erc-20/          # Erc20Service
│   │   ├── Erc4626Service.ts
│   │   └── Permit2Service.ts
│   ├── abis/                # 26 contract ABI files
│   ├── config/              # ConfigService + ConfigMapper
│   ├── constants.ts         # SDK-wide constants (chain mappings, DEX pools, defaults)
│   ├── types/
│   │   ├── types.ts         # Core HubProvider type
│   │   ├── spoke-types.ts   # DepositParams, SendMessageParams, SpokeApproveParams, tx-receipt helpers
│   │   ├── relay-types.ts   # IntentRelay types
│   │   └── intent-types.ts  # Intent/order shapes
│   ├── guards.ts            # Type guards for chain/provider detection
│   └── utils/               # Shared utilities (fee calc, address derivation, chain-specific helpers)
├── swap/                    # Intent-based swap via solver
├── moneyMarket/             # Lending/borrowing + math-utils/ (RAY precision arithmetic)
├── bridge/                  # Cross-chain token bridging
├── staking/                 # SODA token staking
├── dex/                     # DEX operations (concentrated liquidity, asset management)
├── migration/               # Token migration (ICX, bnUSD, BALN)
├── partner/                 # Partner fee operations
├── recovery/                # Hub-wallet asset recovery
├── backendApi/              # Backend API service
└── e2e-tests/               # End-to-end tests
```

## Key Patterns

### Service Pattern

Every module follows a consistent service-based pattern:

1. A `*Service` class with constructor-based dependency injection
2. Constructor receives `{ hubProvider, config, spoke }` (`spoke` is a `SpokeService` instance)
3. Public methods for core operations
4. `Result<T>` return type for operations that can fail

### SpokeService Pattern

Chain-specific logic lives in per-chain-family spoke services (`EvmSpokeService`, `SolanaSpokeService`, `SuiSpokeService`, `IconSpokeService`, `InjectiveSpokeService`, `StellarSpokeService`, `StacksSpokeService`, `NearSpokeService`, `BitcoinSpokeService`, `SonicSpokeService`) all owned by the single `SpokeService` router.

Feature services call into spoke logic by calling `this.spoke.getSpokeService(chainKey)`, which returns the correct service instance for that chain. This replaces the old pattern of constructing per-chain `*SpokeProvider` objects.

The chain key in the request payload (e.g. `srcChainKey`) drives both TypeScript narrowing (via `GetWalletProviderType<K>`) and runtime routing (via `getChainType(chainKey)` in `@sodax/types`).

### Type Guards

`src/shared/guards.ts` contains runtime type guards for chain/provider detection:
- `isEvmSpokeChainConfig()`, `isSolanaChainKeyType()`, etc.
- `isUndefinedOrValidWalletProviderForChainKey()` (swap/raw), `isDefinedWalletProviderValidForChainKey()` (approve/exec)
- `isConfiguredSolverConfig()`, `isConfiguredMoneyMarketConfig()`, etc.
- Used throughout services to branch on chain-specific logic

### Error Handling

All async public methods on services return `Result<T>` (= `{ ok: true; value: T } | { ok: false; error: Error | unknown }`) and wrap their bodies in `try/catch`. The `Result` type is defined in `@sodax/types`.

#### Result<T> propagation pattern

Match the SpokeService pattern exactly:

```ts
// Inner sub-Result: forward as-is
const sub = await this.subOperation();
if (!sub.ok) return sub;

// Outer catch: propagate raw
try {
  // ...
} catch (error) {
  return { ok: false, error };
}
```

Do not re-wrap with module-specific error codes. There is no `MoneyMarketError<Code>` / `SwapError<Code>` taxonomy — callers branch on the error message or `.cause`, not a typed discriminator.

#### Error message convention

Two forms coexist, each with a specific use. **The rule of thumb: if the error comes from a `catch` block, it's CODE form. If it comes from an `invariant`-style guard before any async call, it's prose.**

**CODE form — `new Error('<CODE>_FAILED', { cause?: underlying })`**

Use for **phase tags**: errors that tag a specific stage of a multi-step operation (submit / wait / post-execution / simulation / relay / HTTP request). `<CODE>` is `SCREAMING_SNAKE_CASE`, ending in `_FAILED` or `_TIMEOUT`. Attach `{ cause }` whenever an underlying error exists (standard ES2022 `Error.cause`). Omit `cause` only when there is nothing lower-level to attach (e.g., a boolean simulation returned `false` without a wrapped throw).

```ts
// With cause (a lower-level error was caught and re-wrapped)
return { ok: false, error: new Error('POST_EXECUTION_FAILED', { cause: result.error }) };
return { ok: false, error: new Error('HTTP_REQUEST_FAILED', { cause: new Error(`HTTP ${status}: ${text}`) }) };

// Without cause (the operation itself reported failure via a boolean/status, not via an exception)
return { ok: false, error: new Error('SIMULATION_FAILED') };
return { ok: false, error: new Error('RELAY_TIMEOUT') };
```

**Prose form — `new Error('<human sentence>')`**

Use for **preconditions / invariants**: input validation, unsupported chain type, "not found" on config lookup, bad params, missing address. These have no underlying error to wrap — the prose *is* the information. Typically paired with `invariant()` or guarding an early-return inside a service method.

```ts
invariant(params.amount > 0n, 'Amount must be greater than 0');
return { ok: false, error: new Error('Approve only supported for EVM/Stellar spoke chains') };
return { ok: false, error: new Error('Pool has no hook configured') };
```

**Invariants via `invariant()`** from `tiny-invariant` stay prose — those throw inside the outer `try/catch` which catches them and forwards as-is via `return { ok: false, error }`.

## Module-Specific Notes

### moneyMarket

The most complex module. `moneyMarket/math-utils/` contains financial calculation utilities:
- **RAY precision** (27 decimals) arithmetic in `ray.math.ts`
- Compounded interest calculations
- Reserve incentive and user position formatting
- These are ported from Aave's math libraries — do not simplify the precision handling

### swap

Intent-based architecture:
- `SwapService` creates intents (orders)
- `SolverApiService` communicates with the solver to get quotes and submit intents
- `EvmSolverService` handles on-chain solver interactions
- Supports both market orders and limit orders

### bridge

Cross-chain token transfers via hub-and-spoke vault architecture:
- `BridgeService` — allowance checks, approvals, full bridge execution, bridgeable amount/token queries
- Flow: deposit on spoke → relay to hub → vault deposit/withdrawal → transfer to destination spoke
- `bridge()` returns `[spokeTxHash, hubTxHash]` — handles the full relay lifecycle
- `createBridgeIntent()` only executes on spoke (no relay) — useful when you need manual relay control
- `getBridgeableAmount()` respects vault deposit limits (spoke→hub) and asset manager balances (hub→spoke)
- Tokens are bridgeable if they share the same vault on the hub

### staking

SODA token staking via ERC-4626 vault (xSoda):
- `StakingService` — stake, unstake, instant unstake, claim, cancel unstake + info getters
- `StakingLogic` — static utility class for contract encoding and on-chain reads
- **Tokens:** SODA (staked) → xSoda (ERC-4626 vault shares, proportional to exchange rate)
- **Unstake** has a waiting period with linear penalty (configurable max 1-100%)
- **Instant unstake** bypasses the waiting period but pays slippage (via StakingRouter)
- **Claim** redeems SODA after the unstaking period expires
- Info methods: `getStakingInfo()`, `getUnstakingInfo()`, `getStakingConfig()`, `getStakeRatio()`, `getInstantUnstakeRatio()`

### migration

Token migration for legacy ICON ecosystem tokens:
- `MigrationService` — facade over three sub-services
- `IcxMigrationService` — ICX/wICX → SODA (and reverse via `revertMigration`)
- `BnUSDMigrationService` — legacy bnUSD (ICON/Sui/Stellar) ↔ new bnUSD (EVM chains) via vault transformations
- `BalnSwapService` — BALN → SODA with lockup periods (0–24 months) that multiply rewards (0.5x–1.5x)
- All migrations follow the same pattern: spoke deposit → relay to hub → hub contract execution
- BALN has lock management: `claim()`, `claimUnstaked()`, `stake()`, `unstake()`, `cancelUnstake()`

### dex

Concentrated liquidity (similar to Uniswap V3/PancakeSwap V3):
- `ConcentratedLiquidityService` — position management, liquidity supply/decrease
- `AssetService` — DEX asset wrapping/unwrapping
- Pool configs defined in `src/shared/constants.ts`

## Documentation

Detailed feature docs are in `docs/`:
- `SWAPS.md`, `MONEY_MARKET.md`, `STAKING.md`, `BRIDGE.md`, `DEX.md`, `MIGRATION.md`
- `CONFIGURE_SDK.md` — SDK initialization patterns
- `WALLET_PROVIDERS.md` — wallet integration patterns
- `ARCHITECTURE_REFACTOR_SUMMARY.md` — full architecture reference (spoke services, raw tx handling, Result\<T\>, error convention, wallet-sdk patterns)

Read these when working on a specific feature for detailed flow documentation.

## Build

tsup: dual ESM (`.mjs`) + CJS (`.cjs`). Target: Node 18+, also runs in browser.
`near-api-js` and `@sodax/types` are bundled (not externalized) for CJS compatibility.

## Tests

Vitest. Co-located with source (`*.test.ts`). E2E tests in `src/e2e-tests/`.

```bash
pnpm test          # Unit tests
pnpm test-e2e      # E2E tests
pnpm coverage      # Coverage report
```
