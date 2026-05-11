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
 └── spoke: SpokeService
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

All 7 feature modules (swap, moneyMarket, bridge, staking, migration, dex, partner, recovery) emit a single canonical error type — `SodaxError<C>` — with a closed, reason-only code vocabulary. Codes describe **what** went wrong (`RELAY_TIMEOUT`, `INTENT_CREATION_FAILED`); the producing feature is carried as a first-class `feature` field on the error.

All async public methods return `Result<T, SodaxError<NarrowCode>>` (= `{ ok: true; value: T } | { ok: false; error }`) and wrap their bodies in `try/catch`. The `Result` type is defined in `@sodax/types`.

#### Canonical error shape (`SodaxError<C>`)

Defined in `src/errors/SodaxError.ts`, with the unified vocabulary in `src/errors/codes.ts`.

```ts
import { SodaxError, isSodaxError, type SodaxErrorCode } from '@sodax/sdk';

class SodaxError<C extends SodaxErrorCode = SodaxErrorCode> extends Error {
  readonly code: C;                  // closed reason union (no feature prefix)
  readonly feature: SodaxFeature;    // 'swap' | 'moneyMarket' | 'bridge' | …
  readonly cause?: unknown;
  readonly context?: SodaxErrorContext;
  toJSON(): { name, code, feature, message, stack, context, cause };
}
```

#### Unified code vocabulary

13 reason-only codes cover every feature:

| Code                     | Meaning                                                                |
|--------------------------|------------------------------------------------------------------------|
| `VALIDATION_FAILED`      | Pre-flight invariant tripped (input shape, unsupported chain, etc.)    |
| `INTENT_CREATION_FAILED` | Building the intent / payload failed                                   |
| `EXECUTION_FAILED`       | Orchestrator-level catch-all (per-op via `context.action`)             |
| `TX_VERIFICATION_FAILED` | Spoke-side `verifyTxHash` returned false / threw                       |
| `TX_SUBMIT_FAILED`       | Spoke tx landed; relay POST submit failed                              |
| `RELAY_TIMEOUT`          | Destination packet didn't reach `executed` within timeout              |
| `RELAY_FAILED`           | Relay polling outage / unrecognised relay error                        |
| `APPROVE_FAILED`         | Token approval call failed                                             |
| `ALLOWANCE_CHECK_FAILED` | Reading on-chain allowance failed                                      |
| `GAS_ESTIMATION_FAILED`  | Gas estimation returned an error                                       |
| `LOOKUP_FAILED`          | Read-only on-chain query / off-chain config fetch                      |
| `EXTERNAL_API_ERROR`     | Upstream API call failed (`context.api: 'solver' \| 'backend'`)        |
| `UNKNOWN`                | Last-resort catch-all                                                  |

Per-feature operation discriminator → `context.action` (e.g. `'supply'`, `'stake'`, `'migrateBaln'`, `'revertMigrateSodaToIcx'`).
Per-method partition for read codes → `context.method` (e.g. `'getStakingInfo'`, `'getBridgeableAmount'`).

#### Rules

- Discriminate on `error.code` and `error.feature`. The `(feature, code)` pair is the canonical Sentry/Datadog tag pair.
- Use `isSodaxError(e)` instead of bare `instanceof SodaxError` in cross-bundle code.
- Each public method declares a **narrow per-method code union** built via `Extract<SodaxErrorCode, ...>` so callers can switch exhaustively. See e.g. `src/swap/errors.ts` for the pattern.
- `error.toJSON()` is the canonical logger-integration surface (Sentry/Pino/Datadog) — `JSON.stringify(error)` invokes it automatically. Bigints in `context` are coerced to strings; cause walked depth-3.

#### Result<T> propagation pattern

```ts
// Inner sub-Result: forward as-is (narrowed code subset is structurally assignable to outer)
const sub = await this.subOperation();
if (!sub.ok) return sub;

// Outer catch: narrow guard preserves typed-contract; otherwise wrap as UNKNOWN/EXECUTION_FAILED.
try {
  // …
} catch (error) {
  if (isSupplyError(error)) return { ok: false, error };
  return {
    ok: false,
    error: new SodaxError('EXECUTION_FAILED', error instanceof Error ? error.message : 'supply failed', {
      feature: 'moneyMarket',
      cause: error,
      context: { action: 'supply', phase: 'execution' },
    }),
  };
}
```

#### Shared helpers (in `src/errors/`)

- `sodaxInvariant(cond, message, { feature, context? })` — the single shared invariant. Per-feature 1-line aliases via `createInvariant('feature')` (e.g. `swapInvariant`, `mmInvariant`, `bridgeInvariant`, `stakingInvariant`, `migrationInvariant`, `dexInvariant`, `partnerInvariant`, `recoveryInvariant`).
- `mapRelayFailure(error, { feature, action, srcChainKey?, dstChainKey?, phase? })` — the single shared relay→SodaxError mapper. Replaces the 5 per-feature mappers. Pass `phase: 'destinationExecution'` for migration's secondary `waitUntilIntentExecuted` watcher.
- `isFeatureError(feature)` — per-feature guard factory. `isSwapError = isFeatureError('swap')` etc.
- `isCodeMember(codes)` — builds a per-method narrow guard from a `Set<SodaxErrorCode>`.

#### Shared relay layer

`relayTxAndWaitPacket` / `submitTransaction` in `IntentRelayApiService.ts` keep the legacy `RELAY_ERROR_CODES` strings (`'SUBMIT_TX_FAILED'`, `'RELAY_TIMEOUT'`, `'RELAY_POLLING_FAILED'`) as a public contract — feature-level callers consume them via `mapRelayFailure`.

## Module-Specific Notes

### moneyMarket

The most complex module. `moneyMarket/math-utils/` contains financial calculation utilities:
- **RAY precision** (27 decimals) arithmetic in `ray.math.ts`
- Compounded interest calculations
- Reserve incentive and user position formatting
- These are ported from Aave's math libraries — do not simplify the precision handling
- **Errors**: All 11 public methods return `Result<T, SodaxError<NarrowCode>>` from the unified vocabulary. The 4 user-facing operations (`supply`/`borrow`/`withdraw`/`repay`) discriminate via `context.action`. Pre-flight reads use `ALLOWANCE_CHECK_FAILED` / `GAS_ESTIMATION_FAILED` (kept distinct for retry semantics). See `docs/MONEY_MARKET.md` Error Handling.

### swap

Intent-based architecture:
- `SwapService` creates intents (orders)
- `SolverApiService` communicates with the solver to get quotes and submit intents
- `EvmSolverService` handles on-chain solver interactions
- Supports both market orders and limit orders
- **Errors**: `swap`, `createIntent`, `postExecution`, `createLimitOrder`, and `createLimitOrderIntent` return `Result<T, SodaxError<NarrowCode>>` from the unified vocabulary. The post-execution path emits `EXECUTION_FAILED` (with `phase: 'postExecution'`) or `EXTERNAL_API_ERROR` (with `api: 'solver'` for solver-API failures, including `solverCode`/`solverDetail` on context). See `docs/SWAPS.md` Error Handling.

### bridge

Cross-chain token transfers via hub-and-spoke vault architecture:
- `BridgeService` — allowance checks, approvals, full bridge execution, bridgeable amount/token queries
- Flow: deposit on spoke → relay to hub → vault deposit/withdrawal → transfer to destination spoke
- `bridge()` returns `[spokeTxHash, hubTxHash]` — handles the full relay lifecycle
- `createBridgeIntent()` only executes on spoke (no relay) — useful when you need manual relay control
- `getBridgeableAmount()` respects vault deposit limits (spoke→hub) and asset manager balances (hub→spoke)
- Tokens are bridgeable if they share the same vault on the hub
- **Errors**: All 6 async public methods return `Result<T, SodaxError<NarrowCode>>` from the unified vocabulary. The single user-facing action carries on `context.action: 'bridge'`. Read-only methods (`getBridgeableAmount`, `getBridgeableTokens`) emit `LOOKUP_FAILED` with `context.method` as the partition. See `docs/BRIDGE.md` Error Handling.

### staking

SODA token staking via ERC-4626 vault (xSoda):
- `StakingService` — stake, unstake, instant unstake, claim, cancel unstake + info getters
- `StakingLogic` — static utility class for contract encoding and on-chain reads
- **Tokens:** SODA (staked) → xSoda (ERC-4626 vault shares, proportional to exchange rate)
- **Unstake** has a waiting period with linear penalty (configurable max 1-100%)
- **Instant unstake** bypasses the waiting period but pays slippage (via StakingRouter)
- **Claim** redeems SODA after the unstaking period expires
- Info methods: `getStakingInfo()`, `getUnstakingInfo()`, `getStakingConfig()`, `getStakeRatio()`, `getInstantUnstakeRatio()`
- **Errors**: All 20 async public methods return `Result<T, SodaxError<NarrowCode>>` from the unified vocabulary. The 5 user-facing operations discriminate via `context.action` (one of `'stake' | 'unstake' | 'instantUnstake' | 'claim' | 'cancelUnstake'`). The 8 read-only info methods all emit `LOOKUP_FAILED` partitioned by `context.method`. `TX_VERIFICATION_FAILED` only appears in `StakeErrorCode` (only `stake` calls `verifyTxHash`). `StakingLogic` keeps its throw-on-error contract — wrapping happens only in `StakingService` public methods. See `docs/STAKING.md` Error Handling.

### migration

Token migration for legacy ICON ecosystem tokens:
- `MigrationService` — facade over three sub-services
- `IcxMigrationService` — ICX/wICX → SODA (and reverse via `revertMigration`)
- `BnUSDMigrationService` — legacy bnUSD (ICON/Sui/Stellar) ↔ new bnUSD (EVM chains) via vault transformations
- `BalnSwapService` — BALN → SODA with lockup periods (0–24 months) that multiply rewards (0.5x–1.5x)
- All migrations follow the same pattern: spoke deposit → relay to hub → hub contract execution
- BALN has lock management: `claim()`, `claimUnstaked()`, `stake()`, `unstake()`, `cancelUnstake()`
- **Errors**: All 11 async public methods on `MigrationService` (4 orchestrators, 4 intent creators, `approve`, `isAllowanceValid`) plus `IcxMigrationService.getAvailableAmount` return `Result<T, SodaxError<NarrowCode>>` from the unified vocabulary. The 4 user-facing operations discriminate via `context.action` (one of `'migratebnUSD' | 'migrateIcxToSoda' | 'revertMigrateSodaToIcx' | 'migrateBaln'`) — the migrate/revert split that v2 expressed as separate codes is now expressed via the action enum. `migratebnUSD` carries `context.direction: 'forward' | 'reverse'` (it dynamically detects direction from token addresses). The relay mapper accepts an optional `phase: 'destinationExecution'` override for `migratebnUSD`'s secondary `waitUntilIntentExecuted` watcher. `TX_VERIFICATION_FAILED` only appears in the forward-orchestrator union. `BalnSwapService` lock methods (`claim`/`claimUnstaked`/`stake`/`unstake`/`cancelUnstake`) and `getDetailedUserLocks` still return `Promise<TxReturnType>` raw (throw on error) — converting them to `Result<T>` is a future cleanup (breaking API change). See `docs/MIGRATION.md` Error Handling.

### dex

Concentrated liquidity (similar to Uniswap V3/PancakeSwap V3):
- `ConcentratedLiquidityService` — position management, liquidity supply/decrease
- `AssetService` — DEX asset wrapping/unwrapping
- Pool configs defined in `src/shared/constants.ts`

## Gotchas

- **Never use `bigint` in types passed to `JSON.stringify`** — it throws `TypeError` at runtime. Use `string` for numeric fields in API request/response types (e.g. anything in `src/backendApi/`). If `bigint` is needed in domain types, convert to string before serialization. Note: `SodaxError.toJSON` already coerces bigints in `context` to strings — see Error Handling above.

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
