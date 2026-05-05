# SDK Architecture Reference

The SODAX SDK is organized around a single principle: **the request payload's "source chain key" is the main input that drives everything** — which chain code runs, and what types TypeScript expects.

Key design points:

- [Concept 1: Spoke Services](#concept-1-spoke-services-no-spoke-providers) — The SDK routes by chain key; no per-chain `*SpokeProvider` classes are required.
- [Concept 2: Sodax Facade & Stateful Services](#concept-2-sodax-facade--stateful-services) — A single `Sodax` instance owns the full service graph.
- [Concept 3: Raw Transaction Handling](#concept-3-raw-transaction-handling) — `raw: true / false` is a discriminated union that enforces wallet-provider rules at compile time.
- [Concept 4: Chain Keys](#concept-4-chain-keys) — All chain constants live under a single `ChainKeys.*` namespace.
- [Concept 5: Result\<T\>](#concept-5-resultt) — Every public async method returns `Promise<Result<T>>` — no throws across service boundaries.
- [Concept 6: Error-message convention](#concept-6-error-message-convention) — CODE form for catch blocks, prose form for precondition guards.

For a direct mapping of old `*_CHAIN_ID` constants to `ChainKeys.*`, see [`packages/sdk/CHAIN_ID_MIGRATION.md`](../CHAIN_ID_MIGRATION.md).

---

## Integration Patterns

### Example A: Selecting a chain (routing)

Select the chain by setting `srcChainKey` in the payload (using `ChainKeys.*`). The SDK routes to the correct spoke service internally.

```ts
// The chain key in the payload is all the SDK needs.
sodax.swaps.createIntent({ params: { srcChainKey: ChainKeys.ETHEREUM_MAINNET, … }, raw: false, walletProvider });
```

### Example B: Signed tx vs raw tx

- **Signed execution**: `{ raw: false, walletProvider: <chain-correct provider> }` → SDK signs/executes, returns a tx hash.
- **Raw transaction**: `{ raw: true }` → SDK returns an unsigned transaction payload.

TypeScript enforces the pairing: passing `walletProvider` when `raw: true` is a compile error; omitting it when `raw: false` is also a compile error. Chain-specific narrowing of `walletProvider` flows from `srcChainKey`. See [Concept 3](#concept-3-raw-transaction-handling) for the mechanism.

### Example C: Chain constants

Import and use `ChainKeys`:

```ts
import { ChainKeys } from '@sodax/types';

ChainKeys.SONIC_MAINNET       // was: SONIC_MAINNET_CHAIN_ID
ChainKeys.ARBITRUM_MAINNET    // was: ARBITRUM_MAINNET_CHAIN_ID
```

For a direct rename mapping see `packages/sdk/CHAIN_ID_MIGRATION.md`.

---

## Concept 1: Spoke Services (no spoke providers)

### How it works

The SDK does not require callers to construct per-chain `*SpokeProvider` objects. Instead:

- **Source chain keys in payloads**: swaps use `params.srcChainKey`; spoke helpers use `srcChainKey`.
- **Typed wallet-provider slots** (`WalletProviderSlot<K, Raw>`): for signed execution (`raw: false`), a chain-specific `walletProvider` is required and chain-narrowed; for raw transaction building (`raw: true`), `walletProvider` is forbidden.

At runtime, the SDK routes actions by chain key using `getChainType(chainKey)` (from `@sodax/types`) and dispatches into the correct per-chain spoke service via `SpokeService`.

`SpokeService` owns one per-chain-family service instance (EVM, Sonic/hub, ICON, Sui, Solana, Stellar, Injective, Near, Stacks, Bitcoin) and provides a typed `getSpokeService(chainKey)` router.

### How chain keys narrow types

When a caller supplies a literal chain key (e.g. `ChainKeys.ETHEREUM_MAINNET`), TypeScript preserves it as a specific value type. From that one value the type system derives:

- the chain family via `GetChainType<K>` (EVM, ICON, SOLANA, …)
- the correct wallet provider interface via `GetWalletProviderType<K>`
- the correct raw transaction return shape via `TxReturnType<K, true>`

So instead of "the provider class tells us the chain", it's "the payload's chain key tells us the chain".

---

## Concept 2: Sodax Facade & Stateful Services

### The service graph

`Sodax` constructs and wires all dependencies once at construction time, then reuses them across calls:

```
Sodax
 ├── swaps: SwapService          (intent-based swaps via solver)
 ├── moneyMarket: MoneyMarketService  (cross-chain lending/borrowing)
 ├── bridge: BridgeService       (cross-chain token transfers)
 ├── staking: StakingService     (SODA token staking)
 ├── dex: DexService             (concentrated liquidity, AMM)
 ├── migration: MigrationService (ICX/bnUSD/BALN migration)
 ├── partners: PartnerService    (partner fee claiming)
 ├── recovery: RecoveryService   (withdraw stuck hub-wallet assets to a spoke chain)
 ├── backendApi: BackendApiService
 ├── config: ConfigService
 ├── hubProvider: EvmHubProvider
 └── spokeService: SpokeService
```

`RecoveryService` withdraws assets stuck in a user's hub wallet abstraction back to a spoke chain. This is useful when a cross-chain operation deposited to the hub but the destination step failed.

### Initialization

```ts
const sodax = new Sodax(optionalConfigOverride);
await sodax.config.initialize(); // fetch dynamic config from backend; falls back to packaged defaults
```

### ConfigService as source of truth

`ConfigService` replaces older static lookup tables:
- Loads current chain/token config from the backend (`initialize()`), with a safe fallback to the packaged defaults in `@sodax/types`
- Exposes "is this token supported / is this chain key valid?" checks and lookup helpers
- Feature flows use `ConfigService` lookups instead of reaching into old global constant maps

---

## Concept 3: Raw Transaction Handling

### The discriminated union: `WalletProviderSlot<K, Raw>`

The discriminated union lives in [`packages/types/src/common/common.ts`](../../types/src/common/common.ts):

```ts
export type WalletProviderSlot<K extends SpokeChainKey | ChainType, Raw extends boolean> =
  Raw extends true
    ? { raw: true; walletProvider?: never }
    : { raw: false; walletProvider: GetWalletProviderType<K> };
```

Three rules enforced at compile time:

1. **`raw: true`** → `walletProvider` is **forbidden** (`?: never` rejects any value). Returns a raw tx payload — `TxReturnType<K, true>`, e.g. `EvmRawTransaction`, `SolanaRawTransaction`.
2. **`raw: false`** → `walletProvider` is **required**, chain-narrowed via `GetWalletProviderType<K>` (e.g. `IEvmWalletProvider` for `ChainKeys.ETHEREUM_MAINNET`). Signs/broadcasts, returns a tx hash — `TxReturnType<K, false>`.
3. **Chain narrowing flows from `K`** — when the caller passes a literal chain key, `K` is preserved so `GetWalletProviderType<K>` resolves to the exact interface, not a broad union.

Service methods include this slot via intersection, e.g.:

```ts
export type SwapActionParams<K extends SpokeChainKey, Raw extends boolean> = {
  params: CreateIntentParams<K>;
  skipSimulation?: boolean;
  timeout?: number;
  fee?: PartnerFee;
} & WalletProviderSlot<K, Raw>;
```

### Calling convention

```ts
// Raw — walletProvider is a compile error if passed
sodax.swaps.createIntent({ params, raw: true });

// Signed — walletProvider is required and chain-narrowed
sodax.swaps.createIntent({ params, raw: false, walletProvider: evmWp });
```

### Return types

`TxReturnType<C extends SpokeChainKey | ChainType, Raw extends boolean>` is chain-family-conditional: EVM chains yield `EvmReturnType<Raw>`, Solana yields `SolanaReturnType<Raw>`, etc. Wrapped in `Promise<Result<TxReturnType<K, Raw>>>`:

```ts
// raw: true + ChainKeys.ETHEREUM_MAINNET
Promise<Result<EvmRawTransaction>>

// raw: false + ChainKeys.ETHEREUM_MAINNET
Promise<Result<Hash>>  // `0x…` tx hash
```

---

## Concept 4: Chain Keys

`@sodax/types` defines:
- `ChainKeys` as a `const` object of string chain keys
- `ChainKey` as the union of `ChainKeys` values

The SDK and integrators import `ChainKeys` and use its members rather than importing dozens of separate constants. Extension requires a single addition to `ChainKeys`.

See `packages/sdk/CHAIN_ID_MIGRATION.md` for the full rename mapping.

---

## Concept 5: `Result<T>`

### Shape

`Result<T, E = Error | unknown>` is defined in `packages/types/src/common/common.ts`:

```ts
export type Result<T, E = Error | unknown> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

### Where it applies

Every async public method on `SpokeService`, `BackendApiService`, and every feature service: `SwapService`, `BridgeService`, `MoneyMarketService`, `StakingService`, `MigrationService`, `AssetService`, `ConcentratedLiquidityService`, `PartnerFeeClaimService`, `RecoveryService`.

Private helpers may still throw; the outer `try/catch` at each method's boundary absorbs those and converts them to `{ ok: false, error }`.

### Propagation pattern

```ts
// Forward a sub-Result without re-wrapping
const sub = await this.subOperation();
if (!sub.ok) return sub;

// Success
return { ok: true, value: … };

// Outer catch at every method's boundary
catch (error) { return { ok: false, error }; }
```

There is no `toResult` / `tryCatch` / `safeCall` helper. Explicit `try/catch` is deliberate.

### Branching on errors

Module-specific typed error unions (e.g. `MoneyMarketError<Code>`, `IntentError<Code>`) are deleted. Branch on the error message (and/or `.cause`):

```ts
// After
if (!result.ok && result.error instanceof Error &&
    result.error.message === 'CREATE_SUPPLY_INTENT_FAILED') { … }
```

---

## Concept 6: Error-message convention

Two forms of `new Error(…)` coexist. **Rule of thumb: if the error comes from a `catch` block, it's CODE form. If it comes from an `invariant`-style guard before any async call, it's prose.**

### CODE form — `new Error('PHASE_FAILED', { cause?: underlying })`

For **phase tags** — errors that originate in a `catch` block and wrap a lower-level failure. `PHASE` is `SCREAMING_SNAKE_CASE`, ending in `_FAILED` or `_TIMEOUT`.

```ts
// With cause (a lower-level error was caught and re-wrapped)
return { ok: false, error: new Error('POST_EXECUTION_FAILED', { cause: result.error }) };
return { ok: false, error: new Error('HTTP_REQUEST_FAILED', { cause: new Error(`HTTP ${status}: ${text}`) }) };

// Without cause (operation reported failure via boolean/status, not an exception)
return { ok: false, error: new Error('SIMULATION_FAILED') };
return { ok: false, error: new Error('RELAY_TIMEOUT') };
```

### Prose form — `new Error('<human sentence>')`

For **preconditions / invariants** — input validation, unsupported chain type, config lookup failures. No underlying error to wrap — the prose is the information.

```ts
invariant(params.amount > 0n, 'Amount must be greater than 0');
return { ok: false, error: new Error('Approve only supported for EVM/Stellar spoke chains') };
```

### `Error.cause`

Attach `cause` whenever a lower-level error exists (most CODE-form sites). Omit only when the failure is boolean/status-derived with no wrapped throw.

See [`packages/sdk/CLAUDE.md`](../CLAUDE.md) for the full convention with worked examples.

---

## Wallet-SDK Core: Configurable Wallet Providers

`packages/wallet-sdk-core` implements all chain-specific signing and broadcasting. It is dependency-free from React and can be used directly in Node.js scripts or bots.

### Folder-per-provider layout

Each chain lives in `src/wallet-providers/<chain>/` with co-located files:

```
wallet-providers/
├── BaseWalletProvider.ts      # Abstract base
├── evm/
│   ├── EvmWalletProvider.ts
│   ├── types.ts
│   ├── EvmWalletProvider.test.ts
│   └── index.ts
├── solana/ …
├── sui/ …
├── icon/ …
├── injective/ …
├── stellar/ …
├── stacks/ …
├── bitcoin/ …
└── near/ …
```

### `BaseWalletProvider<TDefaults>`

Abstract generic base class shared by all nine providers:

```ts
abstract class BaseWalletProvider<TDefaults extends object> {
  protected readonly defaults: TDefaults;

  abstract getWalletAddress(): Promise<string>;

  // Merge per-call options over defaults[key] (for per-method defaults objects, e.g. EVM)
  protected mergePolicy<K extends keyof TDefaults>(key: K, options?: …): TDefaults[K]

  // Merge per-call options over the entire defaults object (for flat defaults, e.g. ICON)
  protected mergeDefaults(options?: Partial<TDefaults>): TDefaults
}
```

Subclasses call `super(config.defaults)` in their constructor and use `mergePolicy` / `mergeDefaults` to apply per-call overrides.

### Dual config variants

Every provider supports two runtime modes, discriminated by field presence (EVM, ICON, Solana, Sui, Stellar, Stacks, Injective, NEAR) or by an explicit `type` field (Bitcoin):

| Mode | When to use | Key fields |
|------|-------------|------------|
| **Private key** | Node.js scripts, bots, E2E tests | `privateKey`, `rpcUrl` |
| **Browser extension** | dApps (wallet SDK React layer hands pre-built clients in) | `walletClient` / `walletAddress` (chain-specific) |

### `chainType` discriminant

Every `I*WalletProvider` interface declares a `readonly chainType: '<CHAIN>'` literal:

```ts
// Discriminate at runtime without instanceof
if (walletProvider.chainType === 'EVM') { … }
if (walletProvider.chainType === 'SOLANA') { … }
```

Supported values: `'EVM'`, `'BITCOIN'`, `'SOLANA'`, `'STELLAR'`, `'SUI'`, `'ICON'`, `'INJECTIVE'`, `'STACKS'`, `'NEAR'`.

### Supported chains

| Chain | Provider class | Native SDK |
|-------|----------------|------------|
| EVM (12 chains) | `EvmWalletProvider` | viem |
| Solana | `SolanaWalletProvider` | @solana/web3.js |
| Sui | `SuiWalletProvider` | @mysten/sui |
| ICON | `IconWalletProvider` | icon-sdk-js |
| Injective | `InjectiveWalletProvider` | @injectivelabs/sdk-ts |
| Stellar | `StellarWalletProvider` | @stellar/stellar-sdk |
| Stacks | `StacksWalletProvider` | @stacks/transactions |
| Bitcoin | `BTCWalletProvider` | bitcoinjs-lib (PSBT) |
| NEAR | `NearWalletProvider` | near-api-js |

---

## Wallet-SDK React: Chain Registry & XService/XConnector

`packages/wallet-sdk-react` is the React layer over wallet-sdk-core. It manages wallet connections, connector discovery, and exposes typed wallet providers to the SDK layer via a single hook.

### Core abstractions

- **`XService`** — per-chain service singleton. Manages the live connection, provides signing, and exposes a typed `walletProvider` (implements the SDK's `I*WalletProvider` interface).
- **`XConnector`** — wallet connector adapter. Represents one installable wallet (MetaMask, Phantom, Hana, etc.) and knows how to initiate a connection to an `XService`.

### Chain registry (`chainRegistry.ts`)

Central dispatch that registers all nine chains. Each chain provides a `ChainServiceFactory`:

```ts
type ChainServiceFactory = {
  createService(walletConfig?: SodaxWalletConfig): XService;
  defaultConnectors(walletConfig?: SodaxWalletConfig): XConnector[];
  displayName: string;
  iconUrl?: string;
  providerManaged: boolean;                                         // true → needs a React context provider
  createActions?(service, getStore): ChainActions;
  createWalletProvider?(service, getStore): IWalletProvider | undefined;
  discoverConnectors?(service, getStore): Promise<void>;
};
```

`createChainServices()` iterates the registry, instantiates services and connectors, registers `ChainActions` for non-provider chains, and triggers async connector discovery (Stellar, NEAR, Bitcoin, Stacks).

### Provider-managed vs non-provider chains

**Provider-managed (EVM, Solana, Sui)** — require a React context wrapper (wagmi, wallet-adapter, dapp-kit). Each has three components:

- **Provider** — wraps the chain's native SDK provider (e.g. wagmi's `WagmiProvider`)
- **Hydrator** — syncs native SDK state → Zustand store. Only this component writes connection state (single-writer rule).
- **Actions** — registers `ChainActions` without writing state directly.

**Non-provider (Bitcoin, ICON, Injective, Stellar, NEAR, Stacks)** — use direct browser extension APIs. No React context required; `ChainActions` are registered directly by the chain registry.

### Zustand store

`useXWalletStore` is the centralized connection state:
- Middleware stack: `devtools → persist → immer`
- Only `xConnections` is persisted (localStorage key: `'xwagmi-store'`)
- `cleanupDisabledConnections()` removes stale persisted connections on startup

### Bridge to the SDK: `useWalletProvider`

```ts
const walletProvider = useWalletProvider({ xChainId: ChainKeys.ETHEREUM_MAINNET });
// walletProvider is typed as IEvmWalletProvider — ready to pass as `walletProvider` in SDK calls

await sodax.swaps.createIntent({ params, raw: false, walletProvider });
```

This is the primary integration point between the React wallet layer and the SDK's typed `walletProvider` slots.

---

## @sodax/types: Breaking Changes from v1

Integrators upgrading from v1 will encounter these breaking changes:

- **Removal of the old constants index**: the previous `packages/types/src/constants/index.ts` export surface was deleted. Code importing `*_CHAIN_ID` (or other "constants index" exports) must migrate to `ChainKeys.*` and to the new chain/token modules.
- **Re-organization into domain modules**: chain keys, chain metadata, and token catalogs now live under clearer modules (not a single giant "constants" barrel). Imports may need updating to new entrypoints.
- **Renames / new entrypoints**:
  - Bitcoin types are exposed under `bitcoin` (not `btc`)
  - Several domains available as explicit modules (e.g. `chains`, `swap`, `wallet`)
- **Chain-key-driven wallet typing**: the recommended way to express "wallet provider for chain X" is `GetWalletProviderType<ChainKey>`. When you pass a specific `srcChainKey`, TypeScript infers the correct provider interface automatically.
- **`ChainId` type renamed to `SpokeChainKey`** — same value union (chain-key strings). Consumers that typed params as `ChainId` must switch.
- **`XToken.xChainId` → `XToken.chainKey`** — the field on tokens now matches the `ChainKey` vocabulary.
- **`AddressType` renamed to `BtcAddressType`** — Bitcoin-specific address-type union (`'P2PKH' | 'P2SH' | 'P2WPKH' | 'P2TR'`). Bitcoin wallet-provider implementations must import the new name.
- **Wallet-provider `chainType` discriminants** — every `I*WalletProvider` now declares `readonly chainType: '<CHAIN>'` as a literal field. Custom implementations must add the field.
- **`RpcConfig` shape** — now a mapped type keyed by `ChainKey` **values** (`rpcConfig[ChainKeys.SONIC_MAINNET]`), with `BitcoinRpcConfig` for Bitcoin, `StellarRpcConfig` for Stellar, and `string` (the RPC URL) for every other chain.
- **`IConfigApi` now returns `Promise<Result<T>>`** — every method on the backend-API contract (`getChains`, `getSwapTokens`, `getSwapTokensByChainId`, `getMoneyMarketTokens`, `getMoneyMarketTokensByChainId`). External implementers must update method signatures.
- **Module error types deleted** — `MoneyMarketError<Code>`, `IntentError<Code>`, `StakingError<Code>`, `BridgeError<Code>`, `MigrationError<Code>`, `AssetServiceError<Code>`, `ConcentratedLiquidityError<Code>`, `RelayError`, plus five Partner error types and their type-guard helpers. See [Concept 5](#concept-5-resultt) for the `Result<T>` replacement and [Concept 6](#concept-6-error-message-convention) for how error CODEs appear on `error.message`.

If you maintain wrappers/enums around chain identifiers, they should now accept/emit the **string keys from `ChainKeys`**.
