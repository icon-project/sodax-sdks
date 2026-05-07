<!-- packages/sdk/docs/DEX.md -->
# DEX (Concentrated Liquidity)

> **Error handling conventions:** This module uses the **relay-layer contract** — discriminate on `error.message === 'RELAY_TIMEOUT'` / `'SUBMIT_TX_FAILED'` (also exported as `RELAY_ERROR_CODES` from `@sodax/sdk`). The **swap module** uses a different convention (`SodaxError<SwapErrorCode>` — see [SWAPS.md](./SWAPS.md) Error Handling). Both conventions coexist during the swap-first migration; the legacy pattern documented below is unchanged for DEX.

The DEX portion of the SDK provides helpers for asset wrapping/deposits and concentrated liquidity (CL) operations.
All DEX features are accessible through the `dex` property of a `Sodax` instance.

```typescript
import { Sodax } from "@sodax/sdk";
import { ChainKeys } from "@sodax/sdk";

const sodax = new Sodax();
await sodax.config.initialize();

// Asset operations (deposit/withdraw/allowance)
const assetService = sodax.dex.assetService;

// Concentrated liquidity operations (positions/pools/rewards)
const clService = sodax.dex.clService;
```

All liquidity pools live on the Sonic hub chain. Cross-chain users route assets through the hub-and-spoke relay before
interacting with the pool. The `srcChainKey` field in every action's `params` object identifies the source chain
and drives both TypeScript type narrowing and runtime routing — no per-chain spoke provider construction is needed.

## Call conventions

### `SpokeExecActionParams` wrapper

Every mutating method takes a single argument that follows the `SpokeExecActionParams<K, Raw, Params>` shape:

```typescript
// Signed execution — walletProvider is required and chain-narrowed
await sodax.dex.assetService.deposit({
  params: { srcChainKey: ChainKeys.ETHEREUM_MAINNET, srcAddress: "0xabc...", ... },
  walletProvider: evmWalletProvider, // IEvmWalletProvider
  timeout: 30_000,
});

// Raw transaction — walletProvider is forbidden (compile error if passed)
await sodax.dex.assetService.executeDeposit({
  params: { srcChainKey: ChainKeys.ETHEREUM_MAINNET, srcAddress: "0xabc...", ... },
  raw: true,
});
```

`SpokeExecActionParams` fields:

| Field | Required | Description |
|---|---|---|
| `params` | always | Operation-specific params object (includes `srcChainKey` and `srcAddress`) |
| `raw` | always | `true` → return raw tx payload; `false` → sign and broadcast |
| `walletProvider` | when `raw: false` | Chain-narrowed wallet provider; **forbidden** when `raw: true` |
| `skipSimulation` | optional | Skip tx simulation before broadcasting |
| `timeout` | optional | Relay wait timeout in milliseconds (relay-waiting methods only) |

### `WalletProviderSlot` rules

- `{ raw: true }` — `walletProvider` must be absent. Returns an unsigned transaction payload (`TxReturnType<K, true>`).
- `{ raw: false, walletProvider }` — `walletProvider` is required and chain-narrowed via `GetWalletProviderType<K>`. Returns a tx hash (`TxReturnType<K, false>`).

### Execute vs relay-waiting variants

Each mutating operation has two variants:

- **`execute*`** — broadcasts the spoke-chain transaction and returns `IntentTxResult<K, Raw>` (spoke tx + relay data). Both `raw: true` and `raw: false` are supported.
- **Non-prefixed** (e.g. `deposit`, `supplyLiquidity`) — calls the `execute*` variant and then waits for the cross-chain relay packet to arrive at the hub. Returns `TxHashPair` (`{ srcChainTxHash, dstChainTxHash }`). Only accepts `raw: false`.

## AssetService

Handles wrapping/unwrapping spoke-chain tokens into the StatAToken (ERC-4626) representation used by DEX pools.

### isAllowanceValid

Checks whether sufficient allowance exists for a DEX deposit action.

The required spender varies by chain type:
- **EVM spoke chains**: the chain's `assetManager` contract.
- **Hub chain (Sonic)**: the user's hub wallet address.
- **Stellar**: verifies the sender's trustline.
- **All other non-EVM chains**: always returns `true` (no on-chain approval required).

**Returns:** `Promise<Result<boolean>>`

**Note**: For Stellar-based operations, allowance works differently:
- **Source Chain (Stellar)**: `isAllowanceValid` checks trustlines automatically.
- **Destination Chain (Stellar)**: You must manually check trustlines before executing DEX operations. See [Stellar Trustline Requirements](./STELLAR_TRUSTLINE.md).

**Example:**
```typescript
const result = await sodax.dex.assetService.isAllowanceValid({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    asset: "0x1234...",
    amount: 1000000000000000000n,
    poolToken: "0xabcd...",
  },
  walletProvider: evmWalletProvider,
});

if (result.ok && result.value) {
  console.log("Allowance is sufficient");
} else {
  console.log("Approval or trustline is required");
}
```

### approve

Submits an ERC-20 approval (or Stellar trustline operation) required before depositing.

Supported chain types: Stellar, EVM spoke chains, hub chain (Sonic). Returns an error for other chain types where no approval is needed or supported.

**Returns:** `Promise<Result<TxReturnType<K, Raw>>>`

**Note**: For Stellar-based operations:
- **Source Chain (Stellar)**: `approve` requests trustlines automatically.
- **Destination Chain (Stellar)**: You must establish trustlines before receiving assets. See [Stellar Trustline Requirements](./STELLAR_TRUSTLINE.md).

**Example:**
```typescript
const result = await sodax.dex.assetService.approve({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    asset: "0x1234...",
    amount: 1000000000000000000n,
    poolToken: "0xabcd...",
  },
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  console.log("Approval tx:", result.value);
}
```

### executeDeposit

Builds and broadcasts the spoke-side transaction that wraps tokens into the pool's StatAToken. Returns `IntentTxResult<K, Raw>` (spoke tx + relay data) without waiting for the relay.

Supports both `raw: true` (unsigned tx payload) and `raw: false` (signed broadcast).

**Returns:** `Promise<Result<IntentTxResult<K, Raw>>>`

**Example:**
```typescript
const result = await sodax.dex.assetService.executeDeposit({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    asset: "0x1234...",
    amount: 1000000000000000000n,
    poolToken: "0xabcd...",
  },
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  const { tx, relayData } = result.value;
  // relay manually or wait for packet separately
}
```

### deposit

Wraps assets into the pool's StatAToken and waits for the cross-chain relay to complete. Combines `executeDeposit` with relay packet tracking. For hub-chain (Sonic) callers the relay step is skipped.

Only accepts `raw: false`.

**Returns:** `Promise<Result<TxHashPair>>`

**Example:**
```typescript
const result = await sodax.dex.assetService.deposit({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    asset: "0x1234...",
    amount: 1000000000000000000n,
    poolToken: "0xabcd...",
  },
  walletProvider: evmWalletProvider,
  timeout: 30_000,
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log("Deposit complete:", { srcChainTxHash, dstChainTxHash });
}
```

### executeWithdraw

Builds and broadcasts the spoke-side transaction that unwraps StatATokens back to the original asset. Returns `IntentTxResult<K, Raw>` without waiting for the relay.

Supports both `raw: true` and `raw: false`.

**Returns:** `Promise<Result<IntentTxResult<K, Raw>>>`

### withdraw

Unwraps StatATokens back to the original asset and waits for the cross-chain relay to complete. Combines `executeWithdraw` with relay packet tracking. For hub-chain callers the relay step is skipped.

Only accepts `raw: false`.

**Returns:** `Promise<Result<TxHashPair>>`

**Example:**
```typescript
const result = await sodax.dex.assetService.withdraw({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    poolToken: "0xabcd...",
    asset: "0x1234...",
    amount: 500000000000000000n,
  },
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log("Withdraw complete:", { srcChainTxHash, dstChainTxHash });
}
```

### isSodaAsXSodaInPool

Returns `true` if the asset maps to SODA and the pool token is the hub's xSoda address. Check this before calling `executeDeposit` to route SODA staking deposits through the staking contract instead of the standard wrap path.

**Example:**
```typescript
const isSodaDeposit = sodax.dex.assetService.isSodaAsXSodaInPool({
  chainId: ChainKeys.ETHEREUM_MAINNET,
  asset: "0xsodaAddress...",
  poolToken: "0xpoolToken...",
});
```

### getDeposit

Fetches the user's current DEX deposit balance (in StatAToken shares) for a given pool token, by deriving their hub wallet address from their spoke-chain address.

**Signature:** `getDeposit(poolToken: Address, walletAddress: Address, chainKey: SpokeChainKey): Promise<Result<bigint>>`

**Example:**
```typescript
const result = await sodax.dex.assetService.getDeposit(
  "0xabcd...",   // poolToken (StatAToken on hub)
  "0xabc...",    // user's spoke-chain address
  ChainKeys.ETHEREUM_MAINNET,
);

if (result.ok) {
  console.log("Deposit balance (shares):", result.value);
}
```

### getWrappedAmount / getUnwrappedAmount

Convert between underlying asset amounts and ERC-4626 share amounts for any StatAToken.

**Signatures:**
```typescript
getWrappedAmount(dexToken: Address, assetAmount: bigint): Promise<Result<bigint>>
getUnwrappedAmount(dexToken: Address, shareAmount: bigint): Promise<Result<bigint>>
```

**Example:**
```typescript
const wrappedResult = await sodax.dex.assetService.getWrappedAmount(
  "0xpoolToken...", // StatAToken (ERC-4626) address on hub
  1000000000000000000n,
);

const unwrappedResult = await sodax.dex.assetService.getUnwrappedAmount(
  "0xpoolToken...",
  1000000000000000000n,
);
```

### getTokenWrapAction / getTokenUnwrapAction

Builds the hub-side `EvmContractCall` arrays that encode wrapping/unwrapping without broadcasting them. Intended for advanced use-cases that need to compose multicall payloads manually.

**Signatures:**
```typescript
getTokenWrapAction(
  address: OriginalAssetAddress,
  spokeChainId: SpokeChainKey,
  amount: bigint,
  poolToken: Address,
  recipient: Address,
): Promise<EvmContractCall[]>

getTokenUnwrapAction(
  dstChainKey: SpokeChainKey,
  address: OriginalAssetAddress,
  amount: bigint,
  userAddress: Address,
  recipient: Hex,
): Promise<EvmContractCall[]>
```

## Concentrated Liquidity (CL)

All CL operations are available through `sodax.dex.clService`. The service is an instance of `ClService`.

### executeSupplyLiquidity

Builds and broadcasts the spoke-side transaction that opens a new CL position. Encodes Permit2 approvals for both pool tokens plus a `CLPositionManager.mint` call into a single batched payload. Returns `IntentTxResult<K, Raw>` without waiting for relay.

Supports both `raw: true` and `raw: false`.

**Returns:** `Promise<Result<IntentTxResult<K, Raw>>>`

### supplyLiquidity

Opens a new CL position and waits for the cross-chain relay to complete. Calls `executeSupplyLiquidity` then tracks the relay packet. For hub-chain callers the relay step is skipped.

Only accepts `raw: false`.

**Returns:** `Promise<Result<TxHashPair>>`

**Example:**
```typescript
const result = await sodax.dex.clService.supplyLiquidity({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    poolKey,
    tickLower: -60000n,
    tickUpper: 60000n,
    liquidity: 1000000n,
    amount0Max: 1000000000000000000n,
    amount1Max: 1000000000000000000n,
    sqrtPriceX96,
  },
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
}
```

### getMintPositionEvent

Waits for the hub transaction receipt and extracts the NFT `tokenId` assigned to a newly minted position from the `MintPosition` event log.

**Signature:** `getMintPositionEvent(hubTxHash: Hash): Promise<Result<ClMintPositionEventLog>>`

**Example:**
```typescript
const mintEvent = await sodax.dex.clService.getMintPositionEvent(dstChainTxHash);
if (mintEvent.ok) {
  console.log("Position token ID:", mintEvent.value.tokenId);
}
```

### executeIncreaseLiquidity / increaseLiquidity

Add liquidity to an existing position.

- `executeIncreaseLiquidity` — broadcasts and returns `IntentTxResult<K, Raw>`. Supports `raw: true` and `raw: false`.
- `increaseLiquidity` — calls `executeIncreaseLiquidity` and waits for relay. Only `raw: false`. Returns `TxHashPair`.

**Example:**
```typescript
const result = await sodax.dex.clService.increaseLiquidity({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    poolKey,
    tokenId: 1n,
    tickLower: -60000n,
    tickUpper: 60000n,
    liquidity: 500000n,
    amount0Max: 500000000000000000n,
    amount1Max: 500000000000000000n,
    sqrtPriceX96,
  },
  walletProvider: evmWalletProvider,
});
```

### executeDecreaseLiquidity / decreaseLiquidity

Remove liquidity from an existing position. Accumulated fees are automatically collected by the position manager as part of the decrease.

- `executeDecreaseLiquidity` — broadcasts and returns `IntentTxResult<K, Raw>`. Supports `raw: true` and `raw: false`.
- `decreaseLiquidity` — calls `executeDecreaseLiquidity` and waits for relay. Only `raw: false`. Returns `TxHashPair`.

**Example:**
```typescript
const result = await sodax.dex.clService.decreaseLiquidity({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    poolKey,
    tokenId: 1n,
    liquidity: 250000n,
    amount0Min: 0n,
    amount1Min: 0n,
  },
  walletProvider: evmWalletProvider,
});
```

### executeClaimRewards / claimRewards

Harvest hook rewards for a position. Internally encodes a `decreaseLiquidity` call with `liquidity = 0`, which triggers reward accounting without removing any liquidity.

- `executeClaimRewards` — broadcasts and returns `IntentTxResult<K, Raw>`. Supports `raw: true` and `raw: false`.
- `claimRewards` — calls `executeClaimRewards` and waits for relay. Only `raw: false`. Returns `TxHashPair`.

**Example:**
```typescript
const result = await sodax.dex.clService.claimRewards({
  params: {
    srcChainKey: ChainKeys.ETHEREUM_MAINNET,
    srcAddress: "0xabc...",
    poolKey,
    tokenId: 1n,
    tickLower: -60000n,
    tickUpper: 60000n,
  },
  walletProvider: evmWalletProvider,
});
```

### Pool and Position Data

- `getPools()` — returns the list of configured `PoolKey` objects from `ConfigService`.
- `getAssetsForPool(srcChainKey, poolKey)` — translates hub-side pool currency addresses back to their original spoke-chain `XToken` descriptors.
- `getPoolData(poolKey, publicClient)` — fetches on-chain pool state (price, tick, liquidity, fee tiers, StatAToken enrichment, optional reward config).
- `getPositionInfo(tokenId, publicClient)` — fetches position data, computes current token amounts, unclaimed fees, and (for StatAToken pools) the equivalent underlying amounts.
- `getPoolRewardConfig(poolKey, publicClient)` — fetches reward configuration from the pool's hook contract.

**Example:**
```typescript
const pools = sodax.dex.clService.getPools();
const poolKey = pools[0];

// Translate pool currencies to spoke-chain token descriptors
const { token0, token1 } = sodax.dex.clService.getAssetsForPool(
  ChainKeys.ETHEREUM_MAINNET,
  poolKey,
);

const poolData = await sodax.dex.clService.getPoolData(poolKey, publicClient);
const positionInfo = await sodax.dex.clService.getPositionInfo(1n, publicClient);

const rewardConfig = await sodax.dex.clService.getPoolRewardConfig(poolKey, publicClient);
if (rewardConfig.ok) {
  console.log("Reward config:", rewardConfig.value);
}
```

### Utility Helpers

The CL service exposes static helpers for price/tick and liquidity math:

- `ClService.calculateLiquidityFromAmounts(amount0, amount1, tickLower, tickUpper, currentTick)` — compute the maximum liquidity achievable given both token input amounts (Uniswap V3 math).
- `ClService.calculateAmount1FromAmount0(amount0, tickLower, tickUpper, currentTick, sqrtPriceX96)` — derive the token1 amount paired with a given token0 amount.
- `ClService.calculateAmount0FromAmount1(amount1, tickLower, tickUpper, currentTick, sqrtPriceX96)` — derive the token0 amount paired with a given token1 amount.
- `ClService.calculateMaxAmountsForSlippage(liquidity, tickLower, tickUpper, currentTick, sqrtPriceX96, slippagePercent)` — compute worst-case `amount0Max` / `amount1Max` for a given slippage tolerance. Pass the results directly as `amount0Max` / `amount1Max` in supply/increase params.
- `ClService.priceToTick(price, token0, token1, tickSpacing)` — convert a human-readable price (token1 per token0) to the nearest initializable tick.

**Example:**
```typescript
const liquidity = ClService.calculateLiquidityFromAmounts(
  amount0,
  amount1,
  tickLower,
  tickUpper,
  currentTick,
);

const { amount0Max, amount1Max } = ClService.calculateMaxAmountsForSlippage(
  liquidity,
  tickLower,
  tickUpper,
  currentTick,
  sqrtPriceX96,
  0.5, // 0.5% slippage
);
```

## Types

### AssetService Types

```typescript
export type CreateAssetDepositParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  asset: OriginalAssetAddress;
  amount: bigint;
  poolToken: Address;
  dst?: DestinationParamsType;
};

export type CreateAssetWithdrawParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: GetAddressType<K>;
  poolToken: Address;
  asset: OriginalAssetAddress;
  amount: bigint;
  dst?: DestinationParamsType;
};

// Action wrappers (SpokeExecActionParams adds raw/walletProvider/skipSimulation/timeout)
export type AssetDepositAction<K extends SpokeChainKey, Raw extends boolean> =
  SpokeExecActionParams<K, Raw, CreateAssetDepositParams<K>>;

export type AssetWithdrawAction<K extends SpokeChainKey, Raw extends boolean> =
  SpokeExecActionParams<K, Raw, CreateAssetWithdrawParams<K>>;
```

### Concentrated Liquidity Types

```typescript
export type ClSupplyParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  poolKey: PoolKey;
  tickLower: bigint;
  tickUpper: bigint;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  sqrtPriceX96: bigint;
};

export type ClIncreaseLiquidityParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  poolKey: PoolKey;
  tokenId: bigint;
  tickLower: bigint;
  tickUpper: bigint;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  sqrtPriceX96: bigint;
};

export type ClDecreaseLiquidityParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  poolKey: PoolKey;
  tokenId: bigint;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
};

export type ClClaimRewardsParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  poolKey: PoolKey;
  tokenId: bigint;
  tickLower: bigint;
  tickUpper: bigint;
};
```

### Return Types

```typescript
// Relay-waiting methods (deposit, withdraw, supplyLiquidity, etc.)
export type TxHashPair = {
  srcChainTxHash: string; // spoke-chain tx hash
  dstChainTxHash: string; // hub-chain tx hash
};

// Execute methods (executeDeposit, executeSupplyLiquidity, etc.)
export type IntentTxResult<K extends SpokeChainKey, Raw extends boolean> = {
  tx: TxReturnType<K, Raw>;    // hash (raw: false) or unsigned tx bytes (raw: true)
  relayData: { address: `0x${string}`; payload: Hex };
};
```

## Error Handling

All async public methods return `Promise<Result<T>>`:

```typescript
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error | unknown };
```

There are no module-specific typed error discriminators (`AssetServiceError<Code>` and `ConcentratedLiquidityError<Code>` have been removed). Branch on `result.error.message` for CODE-form errors, and check `.cause` for the underlying error:

```typescript
if (!result.ok) {
  if (result.error instanceof Error) {
    // CODE-form errors (from catch blocks): e.g. 'RELAY_TIMEOUT', 'GET_POOL_DATA_FAILED'
    console.error("Error code:", result.error.message);
    // Underlying cause (if any)
    if (result.error.cause) console.error("Cause:", result.error.cause);
  }
}
```

Common error message codes emitted by these services:

**AssetService:**
- `RELAY_TIMEOUT` — relay packet did not arrive within the timeout

**ConcentratedLiquidityService (`ClService`):**
- `GET_POOL_DATA_FAILED`
- `GET_POSITION_INFO_FAILED`
- `GET_POOL_REWARD_CONFIG_FAILED`
- `GET_MINT_POSITION_EVENT_FAILED`
- `RELAY_TIMEOUT`

Prose-form error messages (precondition failures) include: `'Amount must be greater than 0'`, `'Approve only supported for EVM/Stellar spoke chains'`, `'Pool has no hook configured'`.

## Usage Flow

1. **Check allowance** using `assetService.isAllowanceValid()`
2. **Approve** using `assetService.approve()` if needed (trustlines are handled automatically for Stellar as source)
3. **For Stellar destination chains**: check and establish trustlines manually (see [Stellar Trustline Requirements](./STELLAR_TRUSTLINE.md))
4. **Deposit** using `assetService.deposit()` to wrap tokens into StatAToken pool-token balances
5. **Supply liquidity** using `clService.supplyLiquidity()` (or increase an existing position)
6. **Retrieve tokenId** from the mint event using `clService.getMintPositionEvent(dstChainTxHash)` if needed for subsequent operations
7. **Manage position** using `increaseLiquidity` / `decreaseLiquidity` / `claimRewards`
8. **Withdraw** using `assetService.withdraw()` to unwrap StatATokens back to the original asset
