# Bridge Documentation

The `BridgeService` class, reachable via `sodax.bridge`, orchestrates cross-chain token transfers within the SODAX hub-and-spoke architecture.

Bridging works by depositing tokens into a spoke vault on the source chain, which triggers a cross-chain message relayed to the Sonic hub. The hub then performs vault transformations (deposit/withdraw) and forwards the tokens to the destination chain via the asset manager.

Three transfer directions are supported:
- **Spoke → Hub** — deposit into hub vault
- **Hub → Spoke** — withdrawal from hub vault
- **Spoke → Spoke** — deposit on source + withdraw on destination

## Methods

### isAllowanceValid

Checks whether the caller has sufficient token allowance to execute the bridge.

The required spender varies by chain type:
- **Hub (Sonic)**: the caller's hub wallet router contract
- **EVM spoke**: the spoke chain's asset manager contract
- **Stellar**: validated by the Stellar spoke service (no explicit spender needed)
- **All other chain types** (e.g. Solana, NEAR, Bitcoin): returns `true` — approvals are not applicable

**Parameters:**
- `_params`: `BridgeParams<S, Raw>` — bridge parameters including source chain key, token, amount, and sender address

**Returns:** `Promise<Result<boolean>>`

**Note**: For Stellar-based operations, the allowance system works differently:
- **Source chain (Stellar)**: this method checks and establishes trustlines automatically via the Stellar spoke service.
- **Destination chain (Stellar)**: clients must manually check trustlines using `StellarSpokeService.hasSufficientTrustline` before executing bridge operations.

**Example:**
```typescript
import { ChainKeys } from '@sodax/sdk';

const result = await sodax.bridge.isAllowanceValid({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0xYourAddress...',
    srcToken: '0x1234567890abcdef...',
    amount: 1000000000000000000n, // 1 token in base units
    dstChainKey: ChainKeys.POLYGON_MAINNET,
    dstToken: '0xabcdef1234567890...',
    recipient: '0x9876543210fedcba...',
  },
  raw: false,
  walletProvider: evmWalletProvider,
});

if (result.ok && result.value) {
  console.log('Allowance is sufficient');
} else {
  console.log('Need to approve tokens first');
}
```

### approve

Grants token spending approval required before executing a bridge.

Approval targets differ by chain:
- **Hub (Sonic)**: approves the caller's hub wallet router contract.
- **EVM spoke**: approves the spoke chain's asset manager contract.
- **Stellar**: delegates to the Stellar spoke service for trustline/allowance handling.
- **All other chain types**: returns an error — approvals are not supported.

When `raw` is `true`, the encoded transaction is returned without broadcasting.
When `raw` is `false`, the transaction is signed and submitted via the provided wallet provider.

**Parameters:**
- `_params`: `BridgeParams<K, Raw>` — bridge parameters including source chain key, token, amount, wallet provider, and `raw` flag

**Returns:** `Promise<Result<TxReturnType<K, Raw>>>`

**Note**: For Stellar-based operations, the approval system works differently:
- **Source chain (Stellar)**: this method establishes trustlines automatically.
- **Destination chain (Stellar)**: clients must manually establish trustlines using `StellarSpokeService.requestTrustline` before executing bridge operations.

**Example (signed):**
```typescript
import { ChainKeys } from '@sodax/sdk';

const result = await sodax.bridge.approve({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0xYourAddress...',
    srcToken: '0x1234567890abcdef...',
    amount: 1000000000000000000n,
    dstChainKey: ChainKeys.POLYGON_MAINNET,
    dstToken: '0xabcdef1234567890...',
    recipient: '0x9876543210fedcba...',
  },
  raw: false,
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  console.log('Approval transaction hash:', result.value);
} else {
  console.error('Approval failed:', result.error.message);
}
```

**Example (raw):**
```typescript
const result = await sodax.bridge.approve({
  params: { /* ... */ },
  raw: true,
  // walletProvider must NOT be passed when raw: true
});
```

### Stellar Trustline Requirements

For Stellar-based bridge operations, trustlines must be handled depending on whether Stellar is the source or destination chain. See the [Stellar Trustline Requirements](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/STELLAR_TRUSTLINE.md#bridge) doc for detailed information and code examples.

### bridge

Executes a full end-to-end bridge transfer: spoke deposit → relay → hub settlement.

Internally calls `createBridgeIntent()` to submit the spoke-side deposit transaction, then waits for the cross-chain relay packet to be confirmed on the hub (Sonic). Use this method for the typical "fire and wait" bridge UX.

This method is signed-execution only (`raw: false`). For raw transaction building, use `createBridgeIntent()` directly.

**Parameters:**
- `_params`: `BridgeParams<K, false>` — bridge parameters including source/destination chain keys, token addresses, amount, recipient, wallet provider, and optional `timeout`

**Returns:** `Promise<Result<TxHashPair>>` — `{ srcChainTxHash, dstChainTxHash }` on success, where `srcChainTxHash` is the spoke deposit tx and `dstChainTxHash` is the hub settlement tx.

**Example:**
```typescript
import { ChainKeys } from '@sodax/sdk';

const result = await sodax.bridge.bridge({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0xYourAddress...',
    srcToken: '0x1234567890abcdef...',
    amount: 1000000000000000000n,
    dstChainKey: ChainKeys.POLYGON_MAINNET,
    dstToken: '0xabcdef1234567890...',
    recipient: '0x9876543210fedcba...',
  },
  raw: false,
  walletProvider: evmWalletProvider,
  timeout: 30_000, // optional, defaults to 120 000 ms
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('Bridge successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Bridge failed:', result.error.message);
}
```

### createBridgeIntent

Submits the spoke-side deposit transaction that initiates a bridge transfer, without waiting for the cross-chain relay to complete.

This is the first step of a bridge operation. After this call succeeds you must relay the returned `relayData` to the hub (Sonic) via `relayTxAndWaitPacket` or the intent relay API to complete the transfer. The higher-level `bridge()` method does this automatically — use `createBridgeIntent()` only when you need manual relay control.

When `raw` is `true`, returns the encoded transaction without broadcasting (useful for simulation or batching). When `raw` is `false`, signs and submits the deposit transaction via the provided wallet provider.

**Bitcoin note:** Bitcoin is only supported with `raw: false` because it requires the RadFi trading wallet derivation flow.

**Parameters:**
- `_params`: `BridgeParams<K, Raw>` — bridge parameters including source/destination chain keys, token addresses, amount, recipient, wallet provider, `raw` flag, and optional `skipSimulation`

**Returns:** `Promise<Result<IntentTxResult<K, Raw>>>` — on success, `{ tx, relayData }` where `tx` is the spoke deposit tx hash (or encoded call data when raw), and `relayData` contains the hub wallet address and encoded hub execution payload needed for relay.

**Example (signed):**
```typescript
import { ChainKeys } from '@sodax/sdk';

const result = await sodax.bridge.createBridgeIntent({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0xYourAddress...',
    srcToken: '0x1234567890abcdef...',
    amount: 1000000000000000000n,
    dstChainKey: ChainKeys.POLYGON_MAINNET,
    dstToken: '0xabcdef1234567890...',
    recipient: '0x9876543210fedcba...',
  },
  raw: false,
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  console.log('Spoke deposit tx:', result.value.tx);
  console.log('Relay data:', result.value.relayData);
} else {
  console.error('Bridge intent creation failed:', result.error.message);
}
```

**Note:** This method only executes the transaction on the spoke chain and creates the bridge intent. To successfully bridge tokens you need to:
1. Check if the allowance is sufficient using `isAllowanceValid`
2. Approve the appropriate contract to spend the tokens using `approve`
3. Create the bridge intent using this method
4. Relay the transaction to the hub and await completion (or use the `bridge()` method which handles this automatically)

### getFee

Calculates the partner fee deducted from a given bridge input amount.

Returns `0n` when no partner fee is configured. The fee is denominated in the same units as `inputAmount` (vault token decimals, 18 dp).

**Parameters:**
- `inputAmount`: `bigint` — gross amount being bridged, in vault token base units

**Returns:** `bigint` — fee amount to be deducted, in the same units as `inputAmount`

**Example:**
```typescript
const feeAmount = sodax.bridge.getFee(1000000000000000000n);
console.log('Fee:', feeAmount.toString());
```

### getBridgeableAmount

Returns the maximum amount that can currently be bridged between two tokens, taking into account both deposit capacity on the source side and withdrawal liquidity on the destination side.

The limit type depends on the transfer direction:
- **Spoke → Hub**: constrained by the source vault's remaining deposit capacity (`DEPOSIT_LIMIT`).
- **Hub → Spoke**: constrained by the asset manager balance on the destination spoke (`WITHDRAWAL_LIMIT`).
- **Spoke → Spoke**: the minimum of the deposit capacity (source) and the asset manager balance (destination), normalised to a common unit. The returned `type` indicates which side is the binding constraint.

Returns `{ amount: 0n, type: 'DEPOSIT_LIMIT' }` when the source token is not yet supported by the vault.

**Parameters:**
- `from`: `XToken` — source token (chain key + address) to bridge from
- `to`: `XToken` — destination token (chain key + address) to bridge to

**Returns:** `Promise<Result<BridgeLimit>>` — `{ amount, decimals, type }` where `amount` is the maximum bridgeable quantity in the token's native base units and `decimals` is its decimal precision.

**Example:**
```typescript
import { ChainKeys } from '@sodax/sdk';

const result = await sodax.bridge.getBridgeableAmount(
  {
    address: '0x1234567890abcdef...',
    chainKey: ChainKeys.BASE_MAINNET,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    address: '0xabcdef1234567890...',
    chainKey: ChainKeys.POLYGON_MAINNET,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
);

if (result.ok) {
  console.log('Max bridgeable:', result.value.amount.toString());
  console.log('Decimals:', result.value.decimals);
  console.log('Limit type:', result.value.type); // 'DEPOSIT_LIMIT' | 'WITHDRAWAL_LIMIT'
} else {
  console.error('Error getting bridgeable amount:', result.error);
}
```

### isBridgeable

Determines whether two tokens (potentially on different chains) can be bridged to each other.

Two tokens are bridgeable if they resolve to the same vault address on the Sonic hub, meaning they represent the same underlying asset across chains (e.g. USDC on Base and USDC on Arbitrum both map to the same hub vault).

Returns `false` — rather than throwing — on any resolution or validation error.

**Parameters:**
- `from`: `XToken` — source token to bridge from
- `to`: `XToken` — destination token to bridge to
- `unchecked`: `boolean` (optional, default `false`) — when `true`, skips the `isValidSpokeChainKey` guard. Useful for checking theoretical bridgeability without requiring both chains to be in the active config.

**Returns:** `boolean` — `true` if the tokens share the same hub vault; `false` otherwise.

**Example:**
```typescript
import { ChainKeys } from '@sodax/sdk';

const isBridgeable = sodax.bridge.isBridgeable({
  from: {
    address: '0x1234567890abcdef...',
    chainKey: ChainKeys.BASE_MAINNET,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  to: {
    address: '0xabcdef1234567890...',
    chainKey: ChainKeys.POLYGON_MAINNET,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
});

console.log('Assets are bridgeable:', isBridgeable);
```

### getBridgeableTokens

Returns all tokens on the destination chain that can receive a bridge from the given source token. Filters the destination chain's supported tokens to those that share the same hub vault as the source token.

**Parameters:**
- `from`: `SpokeChainKey` — source chain key
- `to`: `SpokeChainKey` — destination chain key whose supported tokens are searched
- `token`: `string` — source token address on `from`

**Returns:** `Result<XToken[]>` — array of destination-chain tokens bridgeable from the source token; error result if the source token is not found in config.

**Example:**
```typescript
import { ChainKeys } from '@sodax/sdk';

const result = sodax.bridge.getBridgeableTokens(
  ChainKeys.BASE_MAINNET,
  ChainKeys.POLYGON_MAINNET,
  '0x1234567890abcdef...',
);

if (result.ok) {
  console.log('Bridgeable tokens on Polygon:', result.value);
} else {
  console.error('Error getting bridgeable tokens:', result.error);
}
```

## Types

### CreateBridgeIntentParams

```typescript
export type CreateBridgeIntentParams<K extends SpokeChainKey = SpokeChainKey> = {
  srcAddress: string;
  srcChainKey: K;
  srcToken: string;
  amount: bigint;
  dstChainKey: SpokeChainKey;
  dstToken: string;
  recipient: string; // non-encoded recipient address
};
```

### BridgeParams

`BridgeParams` is an alias for `SpokeExecActionParams`, which is a discriminated union combining the intent params with the `WalletProviderSlot`:

```typescript
export type BridgeParams<ChainKey extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  ChainKey,
  Raw,
  CreateBridgeIntentParams<ChainKey>
>;
```

The `WalletProviderSlot<K, Raw>` discriminant enforces at compile time:
- `{ raw: true }` — `walletProvider` is **forbidden**; returns raw tx payload
- `{ raw: false, walletProvider: GetWalletProviderType<K> }` — `walletProvider` is **required** and chain-narrowed; signs and broadcasts

### BridgeLimit

```typescript
type BridgeLimit = {
  amount: bigint;
  decimals: number;
  type: 'DEPOSIT_LIMIT' | 'WITHDRAWAL_LIMIT';
};
```

### TxHashPair

```typescript
type TxHashPair = {
  srcChainTxHash: string;
  dstChainTxHash: string;
};
```

### PartnerFee

```typescript
type PartnerFee = {
  address: string;
  percentage: number; // e.g. 0.1 for 10%
};
```

## Error Handling

All async public methods return `Promise<Result<T>>`:

```typescript
type Result<T, E = Error | unknown> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

No typed error discriminators (`BridgeError<Code>`, etc.) exist in v2. Branch on the error message or `.cause`:

```typescript
if (!result.ok) {
  const error = result.error;
  if (error instanceof Error) {
    // CODE-form errors from catch blocks, e.g. 'CREATE_BRIDGE_INTENT_FAILED'
    console.error('Code:', error.message);
    // Underlying cause, if present
    console.error('Cause:', error.cause);
  }
}
```

Common error message codes (CODE form, from `catch` blocks):
- `'RELAY_TIMEOUT'` — hub relay did not confirm within the timeout
- `'HTTP_REQUEST_FAILED'` — a network call to the relay API failed

Common prose errors (from precondition guards):
- `'Amount must be greater than 0'`
- `'Source asset is required'`
- `'Approval only supported for EVM spoke chains and Stellar'`

## Usage Flow

The typical bridge operation follows this sequence:

1. **Check allowance** using `isAllowanceValid()`
2. **Approve tokens** using `approve()` if needed
3. **For Stellar destination chains**: check and establish trustlines (see [Stellar Trustline Requirements](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/STELLAR_TRUSTLINE.md#bridge))
4. **Execute bridge** using `bridge()` for the full lifecycle, or `createBridgeIntent()` for manual relay control
5. **Monitor progress** using the returned transaction hashes

## Chain Keys

Use `ChainKeys.*` constants from `@sodax/sdk` instead of raw string chain IDs:

```typescript
import { ChainKeys } from '@sodax/sdk';

// Examples
ChainKeys.BASE_MAINNET      // '0x2105.base'
ChainKeys.POLYGON_MAINNET   // '0x89.polygon'
ChainKeys.SONIC_MAINNET     // hub chain
ChainKeys.ETHEREUM_MAINNET
ChainKeys.ARBITRUM_MAINNET
// ... all 20 supported chains
```

The chain key in the request payload (e.g. `srcChainKey`) drives both TypeScript narrowing — so `walletProvider` is automatically typed to the correct interface — and runtime routing inside the SDK.

## Supported Chains

The service supports all 20 chains in the SODAX network:
- **EVM (12):** Sonic (hub), Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche, HyperEVM, Lightlink, Redbelly, Kaia
- **Non-EVM (8):** Solana, Sui, Stellar, ICON, Injective, NEAR, Stacks, Bitcoin

## Partner Fees

Partner fees are configured at `Sodax` construction time via `config.bridge.partnerFee`. They are automatically applied inside `bridge()` and `createBridgeIntent()`. Use `getFee()` to preview the fee amount for a given input:

```typescript
const feeAmount = sodax.bridge.getFee(inputAmount);
const netAmount = inputAmount - feeAmount;
```

Fees are denominated in vault token decimals (18 dp).
