# Staking Documentation

The `StakingService` class, reachable through `sodax.staking`, provides functionality for staking SODA tokens,
unstaking, claiming rewards, and retrieving staking information. It supports operations across all spoke chains
with automatic hub chain integration.

## Setup

```typescript
import { Sodax, ChainKeys } from '@sodax/sdk';

const sodax = new Sodax();
const initResult = await sodax.config.initialize();
if (!initResult.ok) {
  console.error('SDK initialization failed:', initResult.error.message);
}
```

## Calling Convention

All mutating methods accept a single `SpokeExecActionParams` object with the following shape:

```typescript
{
  params: <StakingParams>,   // action-specific params (includes srcChainKey)
  walletProvider: ...,       // required when raw: false; chain-narrowed by srcChainKey
  raw?: boolean,             // false (default) → sign & broadcast; true → return raw tx payload
  skipSimulation?: boolean,  // optional: skip preflight simulation
  timeout?: number,          // optional: relay timeout in milliseconds (default: 60 000)
}
```

**`raw: true` / `raw: false` rules (enforced at compile time):**
- `{ raw: true }` — `walletProvider` is **forbidden**; returns an unsigned transaction payload.
- `{ raw: false, walletProvider }` — `walletProvider` is **required** and chain-narrowed from `srcChainKey`.

## Methods

### isAllowanceValid

Checks whether the current token allowance is sufficient for a `stake`, `unstake`, or `instantUnstake` action.

- **EVM spoke chains**: checks the asset-manager allowance.
- **Hub chain (Sonic)**: checks the user's hub wallet allowance.
- **Stellar**: delegates to the Stellar spoke allowance check (trustlines).
- **Other non-EVM chains**: no on-chain allowance required; always resolves `true`.

**Signature:**
```typescript
async isAllowanceValid<K extends SpokeChainKey, Raw extends boolean>(
  _params: StakingParamsUnion<K, Raw>,
): Promise<Result<boolean>>
```

**Example:**
```typescript
const result = await sodax.staking.isAllowanceValid({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n, // 1 SODA
    minReceive: 950000000000000000n,
    action: 'stake',
  },
  raw: false,
  walletProvider: evmWalletProvider,
});

if (result.ok && result.value) {
  console.log('Allowance is sufficient');
} else if (result.ok) {
  console.log('Need to approve tokens first');
} else {
  console.error('Allowance check failed:', result.error.message);
}
```

### approve

Submits a token-spending approval on the source chain for a `stake`, `unstake`, or `instantUnstake` action.

Supported chains: EVM spoke chains, hub chain (Sonic), and Stellar. All other chains return an error.

The spender address is resolved automatically:
- Hub chain: the user's hub wallet (derived from spoke address).
- EVM spoke chain: the chain's asset-manager contract.

Must be called before executing the corresponding action whenever `isAllowanceValid` returns `false`.

**Signature:**
```typescript
async approve<K extends SpokeChainKey, Raw extends boolean>(
  _params: StakingParamsUnion<K, Raw>,
): Promise<Result<TxReturnType<K, Raw>>>
```

**Example (signed):**
```typescript
const result = await sodax.staking.approve({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n,
    minReceive: 950000000000000000n,
    action: 'stake',
  },
  raw: false,
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  console.log('Approval tx hash:', result.value);
} else {
  console.error('Approval failed:', result.error.message);
}
```

**Example (raw tx):**
```typescript
const result = await sodax.staking.approve({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n,
    minReceive: 950000000000000000n,
    action: 'stake',
  },
  raw: true,
  // walletProvider must not be passed when raw: true
});
```

### Stellar Trustline Requirements

For Stellar-based staking operations, `isAllowanceValid` and `approve` handle trustlines automatically
when Stellar is the source chain. See
[Stellar Trustline Requirements](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/STELLAR_TRUSTLINE.md#staking)
for details.

Staking operations always flow from spoke chains (including Stellar) to the hub chain (Sonic), so Stellar
is only used as a source chain.

### stake

Stakes SODA tokens from a spoke chain, relays the intent to the hub, and waits for hub confirmation.

Internally calls `createStakeIntent` to submit on the spoke, then relays the cross-chain packet and waits
for the hub transaction to land. For hub-chain callers (`srcChainKey: ChainKeys.SONIC_MAINNET`) the spoke
and hub hashes are identical.

**Prerequisite:** call `isAllowanceValid` + `approve` before staking on EVM chains.

**Signature:**
```typescript
async stake<K extends SpokeChainKey>(
  _params: StakeAction<K, false>,
): Promise<Result<TxHashPair>>
```

**Example:**
```typescript
const result = await sodax.staking.stake({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n, // 1 SODA
    minReceive: 950000000000000000n, // 0.95 xSODA minimum
    action: 'stake',
  },
  raw: false,
  walletProvider: evmWalletProvider,
  timeout: 30000,
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('Stake successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Stake failed:', result.error.message);
}
```

### createStakeIntent

Submits the stake transaction on the spoke chain **without** relaying to the hub.

Returns `IntentTxResult` containing the spoke tx result and the `relayData` (hub wallet address + encoded
payload) needed for a subsequent manual relay step. Use `stake` for the full end-to-end flow.

**Signature:**
```typescript
async createStakeIntent<K extends SpokeChainKey, Raw extends boolean>(
  _params: StakeAction<K, Raw>,
): Promise<Result<IntentTxResult<K, Raw>>>
```

**Example:**
```typescript
const result = await sodax.staking.createStakeIntent({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n,
    minReceive: 950000000000000000n,
    action: 'stake',
  },
  raw: false,
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  console.log('Spoke tx:', result.value.tx);
  console.log('Relay data:', result.value.relayData);
}
```

**Full manual flow:**
1. `isAllowanceValid` → check allowance
2. `approve` → approve if needed
3. `createStakeIntent` → spoke tx only
4. `stake` → full relay + hub confirmation (or relay manually using `relayData`)

### unstake

Initiates an unstake request for xSoda shares, relays the intent to the hub, and waits for confirmation.

Unstaking begins a waiting period. The user receives SODA only after calling `claim` once the period
elapses. Early claims incur a linear penalty (see `getStakingConfig`). For immediate redemption without a
waiting period, use `instantUnstake` instead.

**Prerequisite:** call `isAllowanceValid` + `approve` before unstaking on EVM chains.

**Signature:**
```typescript
async unstake<K extends SpokeChainKey>(
  _params: UnstakeAction<K, false>,
): Promise<Result<TxHashPair>>
```

**Example:**
```typescript
const result = await sodax.staking.unstake({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n, // 1 xSODA
    action: 'unstake',
  },
  raw: false,
  walletProvider: evmWalletProvider,
  timeout: 30000,
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('Unstake successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Unstake failed:', result.error.message);
}
```

### createUnstakeIntent

Submits the unstake transaction on the spoke chain **without** relaying to the hub.

**Signature:**
```typescript
async createUnstakeIntent<K extends SpokeChainKey, Raw extends boolean>(
  _params: UnstakeAction<K, Raw>,
): Promise<Result<IntentTxResult<K, Raw>>>
```

**Example:**
```typescript
const result = await sodax.staking.createUnstakeIntent({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n,
    action: 'unstake',
  },
  raw: false,
  walletProvider: evmWalletProvider,
});

if (result.ok) {
  console.log('Spoke tx:', result.value.tx);
  console.log('Relay data:', result.value.relayData);
}
```

### instantUnstake

Instantly redeems xSoda shares for SODA without a waiting period, relays the intent to the hub, and waits
for confirmation. Routes through the StakingRouter, which provides immediate liquidity at the cost of
slippage. Use `getInstantUnstakeRatio` to preview the SODA output before calling this method.

**Prerequisite:** call `isAllowanceValid` + `approve` before instant unstaking on EVM chains.

**Signature:**
```typescript
async instantUnstake<K extends SpokeChainKey>(
  _params: InstantUnstakeAction<K, false>,
): Promise<Result<TxHashPair>>
```

**Example:**
```typescript
const result = await sodax.staking.instantUnstake({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n, // 1 xSODA
    minAmount: 950000000000000000n, // 0.95 SODA minimum
    action: 'instantUnstake',
  },
  raw: false,
  walletProvider: evmWalletProvider,
  timeout: 30000,
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('Instant unstake successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Instant unstake failed:', result.error.message);
}
```

### createInstantUnstakeIntent

Submits the instant-unstake transaction on the spoke chain **without** relaying to the hub.

**Signature:**
```typescript
async createInstantUnstakeIntent<K extends SpokeChainKey, Raw extends boolean>(
  _params: InstantUnstakeAction<K, Raw>,
): Promise<Result<IntentTxResult<K, Raw>>>
```

**Example:**
```typescript
const result = await sodax.staking.createInstantUnstakeIntent({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    amount: 1000000000000000000n,
    minAmount: 950000000000000000n,
    action: 'instantUnstake',
  },
  raw: false,
  walletProvider: evmWalletProvider,
});
```

### claim

Claims SODA from a fully-elapsed unstake request, relays the intent to the hub, and waits for confirmation.

Requires the unstaking period to have passed. Use `getUnstakingInfoWithPenalty` first to preview the
claimable amount when the period may not have fully elapsed.

**Signature:**
```typescript
async claim<K extends SpokeChainKey>(
  _params: ClaimAction<K, false>,
): Promise<Result<TxHashPair>>
```

**Example:**
```typescript
const result = await sodax.staking.claim({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    requestId: 1n,
    amount: 950000000000000000n, // claimable amount after penalty
    action: 'claim',
  },
  raw: false,
  walletProvider: evmWalletProvider,
  timeout: 30000,
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('Claim successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Claim failed:', result.error.message);
}
```

### createClaimIntent

Submits the claim transaction on the spoke chain **without** relaying to the hub.

**Signature:**
```typescript
async createClaimIntent<K extends SpokeChainKey, Raw extends boolean>(
  _params: ClaimAction<K, Raw>,
): Promise<Result<IntentTxResult<K, Raw>>>
```

**Example:**
```typescript
const result = await sodax.staking.createClaimIntent({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    requestId: 1n,
    amount: 950000000000000000n,
    action: 'claim',
  },
  raw: false,
  walletProvider: evmWalletProvider,
});
```

### cancelUnstake

Cancels a pending unstake request and re-stakes the underlying SODA as xSoda shares, relays to the hub,
and waits for confirmation. Aborts the waiting period and redeposits SODA back into the xSoda vault so
the user continues earning staking rewards.

**Signature:**
```typescript
async cancelUnstake<K extends SpokeChainKey>(
  _params: CancelUnstakeAction<K, false>,
): Promise<Result<TxHashPair>>
```

**Example:**
```typescript
const result = await sodax.staking.cancelUnstake({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    requestId: 1n,
    action: 'cancelUnstake',
  },
  raw: false,
  walletProvider: evmWalletProvider,
  timeout: 30000,
});

if (result.ok) {
  const { srcChainTxHash, dstChainTxHash } = result.value;
  console.log('Cancel unstake successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Cancel unstake failed:', result.error.message);
}
```

### createCancelUnstakeIntent

Submits the cancel-unstake transaction on the spoke chain **without** relaying to the hub.

**Signature:**
```typescript
async createCancelUnstakeIntent<K extends SpokeChainKey, Raw extends boolean>(
  _params: CancelUnstakeAction<K, Raw>,
): Promise<Result<IntentTxResult<K, Raw>>>
```

**Example:**
```typescript
const result = await sodax.staking.createCancelUnstakeIntent({
  params: {
    srcChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: '0x1234567890abcdef...',
    requestId: 1n,
    action: 'cancelUnstake',
  },
  raw: false,
  walletProvider: evmWalletProvider,
});
```

### getStakingInfoFromSpoke

Fetches comprehensive staking information for a user identified by their spoke-chain address and chain key.

Resolves the hub wallet address from the spoke address, then delegates to `getStakingInfo`.

**Signature:**
```typescript
async getStakingInfoFromSpoke<K extends SpokeChainKey>(
  srcAddress: Address,
  srcChainKey: K,
): Promise<Result<StakingInfo>>
```

**Example:**
```typescript
const result = await sodax.staking.getStakingInfoFromSpoke(
  '0x1234567890abcdef...',
  ChainKeys.BASE_MAINNET,
);

if (result.ok) {
  const { totalStaked, userXSodaBalance, userXSodaValue } = result.value;
  console.log('Total staked:', totalStaked.toString());
  console.log('User xSODA balance:', userXSodaBalance.toString());
  console.log('User xSODA value in SODA:', userXSodaValue.toString());
} else {
  console.error('Failed to get staking info:', result.error.message);
}
```

### getStakingInfo

Fetches comprehensive staking information for a hub wallet address directly.

**Signature:**
```typescript
async getStakingInfo(userAddress: Address): Promise<Result<StakingInfo>>
```

**Example:**
```typescript
const result = await sodax.staking.getStakingInfo('0xHubWalletAddress...');

if (result.ok) {
  const { totalStaked, userXSodaBalance, userXSodaValue } = result.value;
  console.log('Total staked:', totalStaked.toString());
  console.log('User xSODA balance:', userXSodaBalance.toString());
  console.log('User xSODA value in SODA:', userXSodaValue.toString());
} else {
  console.error('Failed to get staking info:', result.error.message);
}
```

### getUnstakingInfo

Fetches all pending unstake requests and the total SODA amount currently unstaking for a user.

**Signature:**
```typescript
async getUnstakingInfo<K extends SpokeChainKey>(
  srcAddress: Address,
  srcChainKey: K,
): Promise<Result<UnstakingInfo>>
```

**Example:**
```typescript
const result = await sodax.staking.getUnstakingInfo(
  '0x1234567890abcdef...',
  ChainKeys.BASE_MAINNET,
);

if (result.ok) {
  const { totalUnstaking, userUnstakeSodaRequests } = result.value;
  console.log('Total unstaking:', totalUnstaking.toString());
  console.log('Number of requests:', userUnstakeSodaRequests.length);
} else {
  console.error('Failed to get unstaking info:', result.error.message);
}
```

### getUnstakingInfoWithPenalty

Fetches all pending unstake requests enriched with current penalty calculations.

Applies the linear penalty model to each request based on elapsed time:
- Before `minUnstakingPeriod`: `maxPenalty` applies in full.
- Between `minUnstakingPeriod` and `unstakingPeriod`: penalty decreases linearly to zero.
- After `unstakingPeriod`: no penalty.

**Signature:**
```typescript
async getUnstakingInfoWithPenalty<K extends SpokeChainKey>(
  srcAddress: Address,
  srcChainKey: K,
): Promise<Result<UnstakingInfo & { requestsWithPenalty: UnstakeRequestWithPenalty[] }>>
```

**Example:**
```typescript
const result = await sodax.staking.getUnstakingInfoWithPenalty(
  '0x1234567890abcdef...',
  ChainKeys.BASE_MAINNET,
);

if (result.ok) {
  const { totalUnstaking, requestsWithPenalty } = result.value;
  console.log('Total unstaking:', totalUnstaking.toString());

  for (const req of requestsWithPenalty) {
    console.log('Amount:', req.request.amount.toString());
    console.log('Penalty:', req.penalty.toString());
    console.log('Penalty %:', req.penaltyPercentage);
    console.log('Claimable:', req.claimableAmount.toString());
  }
} else {
  console.error('Failed to get unstaking info with penalty:', result.error.message);
}
```

### getStakingConfig

Reads the current staking configuration from the StakedSoda contract.

**Signature:**
```typescript
async getStakingConfig(): Promise<Result<StakingConfig>>
```

**Example:**
```typescript
const result = await sodax.staking.getStakingConfig();

if (result.ok) {
  const { unstakingPeriod, minUnstakingPeriod, maxPenalty } = result.value;
  console.log('Unstaking period (s):', unstakingPeriod.toString());
  console.log('Min unstaking period (s):', minUnstakingPeriod.toString());
  console.log('Max penalty (%):', maxPenalty.toString());
} else {
  console.error('Failed to get staking config:', result.error.message);
}
```

### getInstantUnstakeRatio

Estimates the SODA amount receivable from instantly unstaking a given quantity of xSoda shares.

Calls `StakingRouter.estimateInstantUnstake` on-chain. Use this before calling `instantUnstake` to set
an appropriate `minAmount` slippage guard.

**Signature:**
```typescript
async getInstantUnstakeRatio(amount: bigint): Promise<Result<bigint>>
```

**Example:**
```typescript
const result = await sodax.staking.getInstantUnstakeRatio(1000000000000000000n);

if (result.ok) {
  console.log('Estimated SODA output:', result.value.toString());
} else {
  console.error('Failed to get instant unstake ratio:', result.error.message);
}
```

### getConvertedAssets

Converts a quantity of xSoda shares to its current underlying SODA value using the vault's
`convertToAssets` view function. The result increases over time as staking rewards accrue.

**Signature:**
```typescript
async getConvertedAssets(amount: bigint): Promise<Result<bigint>>
```

**Example:**
```typescript
const result = await sodax.staking.getConvertedAssets(1000000000000000000n);

if (result.ok) {
  console.log('SODA equivalent:', result.value.toString());
} else {
  console.error('Failed to convert assets:', result.error.message);
}
```

### getStakeRatio

Estimates the xSoda shares and preview-deposit amount for a given SODA input. Calls
`StakingRouter.estimateXSodaAmount` on-chain. Use this to display expected output before a stake
transaction.

**Signature:**
```typescript
async getStakeRatio(amount: bigint): Promise<Result<[bigint, bigint]>>
```

**Example:**
```typescript
const result = await sodax.staking.getStakeRatio(1000000000000000000n);

if (result.ok) {
  const [xSodaAmount, previewDepositAmount] = result.value;
  console.log('xSODA you will receive:', xSodaAmount.toString());
  console.log('Preview deposit amount:', previewDepositAmount.toString());
} else {
  console.error('Failed to get stake ratio:', result.error.message);
}
```

## Types

### StakeParams

```typescript
export type StakeParams<K extends SpokeChainKey> = {
  srcChainKey: K;      // chain key of the spoke chain to stake from
  srcAddress: Address; // account to stake from
  amount: bigint;      // SODA amount to stake
  minReceive: bigint;  // minimum xSODA shares to receive (slippage guard)
  action: 'stake';
};
```

### UnstakeParams

```typescript
export type UnstakeParams<K extends SpokeChainKey> = {
  srcChainKey: K;      // chain key of the spoke chain to unstake from
  srcAddress: Address; // account to unstake from
  amount: bigint;      // xSoda share amount to unstake
  action: 'unstake';
};
```

### InstantUnstakeParams

```typescript
export type InstantUnstakeParams<K extends SpokeChainKey> = {
  srcChainKey: K;      // chain key of the spoke chain to instant unstake from
  srcAddress: Address;
  amount: bigint;      // xSoda share amount to redeem
  minAmount: bigint;   // minimum SODA to receive (slippage guard)
  action: 'instantUnstake';
};
```

### ClaimParams

```typescript
export type ClaimParams<K extends SpokeChainKey> = {
  srcChainKey: K;      // chain key of the spoke chain to claim from
  srcAddress: Address;
  requestId: bigint;
  amount: bigint;      // claimable SODA amount after penalty calculation
  action: 'claim';
};
```

### CancelUnstakeParams

```typescript
export type CancelUnstakeParams<K extends SpokeChainKey> = {
  srcChainKey: K;      // chain key of the spoke chain to cancel unstake from
  srcAddress: Address;
  requestId: bigint;
  action: 'cancelUnstake';
};
```

### StakingInfo

```typescript
export type StakingInfo = {
  totalStaked: bigint;      // Total SODA staked (totalAssets from xSODA vault)
  totalUnderlying: bigint;  // Total underlying SODA assets in the vault
  userXSodaBalance: bigint; // User's xSODA shares (raw balance)
  userXSodaValue: bigint;   // User's xSODA value in SODA (converted)
  userUnderlying: bigint;   // User's underlying SODA amount
};
```

### UnstakingInfo

```typescript
export type UnstakingInfo = {
  userUnstakeSodaRequests: readonly UserUnstakeInfo[];
  totalUnstaking: bigint;
};
```

### UnstakeRequestWithPenalty

```typescript
export type UnstakeRequestWithPenalty = UserUnstakeInfo & {
  penalty: bigint;           // SODA withheld as penalty
  penaltyPercentage: number; // 0–100
  claimableAmount: bigint;   // net SODA receivable after penalty
};
```

### StakingConfig

```typescript
export type StakingConfig = {
  unstakingPeriod: bigint;    // full wait duration in seconds; no penalty after this
  minUnstakingPeriod: bigint; // minimum wait in seconds; max penalty before this
  maxPenalty: bigint;         // maximum penalty percentage (1–100)
};
```

### StakingActionType

```typescript
export type StakingActionType = 'stake' | 'unstake' | 'claim' | 'cancelUnstake' | 'instantUnstake';
```

### TxHashPair

Returned by the full relay methods (`stake`, `unstake`, `instantUnstake`, `claim`, `cancelUnstake`):

```typescript
type TxHashPair = {
  srcChainTxHash: string; // transaction hash on the source (spoke) chain
  dstChainTxHash: string; // transaction hash on the destination (hub) chain
};
```

## Error Handling

All async public methods return `Promise<Result<T>>`:

```typescript
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error | unknown };
```

Typed error discriminators (`StakingError<Code>`, etc.) are not used. Branch on `error.message` (CODE
form) or `error.cause` for the underlying failure:

```typescript
const result = await sodax.staking.stake({ ... });

if (!result.ok) {
  if (result.error instanceof Error) {
    // CODE-form errors from catch blocks (e.g. 'RELAY_TIMEOUT', 'STAKE_FAILED')
    console.error('Error code:', result.error.message);
    if (result.error.cause) {
      console.error('Underlying cause:', result.error.cause);
    }
  } else {
    console.error('Unknown error:', result.error);
  }
}
```

Common error messages:
- `'RELAY_TIMEOUT'` — hub packet did not land within the timeout window
- Prose messages — precondition failures (e.g. `'Amount must be greater than 0'`, `'SODA token not found'`)
- `'Approval only supported for EVM spoke chains and [stake, unstake, instantUnstake] operations'`

## Usage Flow

### Full stake flow (EVM spoke chain)

```typescript
// 1. Check allowance
const allowanceResult = await sodax.staking.isAllowanceValid({
  params: { srcChainKey: ChainKeys.BASE_MAINNET, srcAddress, amount, minReceive, action: 'stake' },
  raw: false,
  walletProvider: evmWalletProvider,
});
if (!allowanceResult.ok) throw allowanceResult.error;

// 2. Approve if needed
if (!allowanceResult.value) {
  const approveResult = await sodax.staking.approve({
    params: { srcChainKey: ChainKeys.BASE_MAINNET, srcAddress, amount, minReceive, action: 'stake' },
    raw: false,
    walletProvider: evmWalletProvider,
  });
  if (!approveResult.ok) throw approveResult.error;
}

// 3. Stake (spoke tx + relay + hub confirmation)
const stakeResult = await sodax.staking.stake({
  params: { srcChainKey: ChainKeys.BASE_MAINNET, srcAddress, amount, minReceive, action: 'stake' },
  raw: false,
  walletProvider: evmWalletProvider,
  timeout: 60000,
});
if (!stakeResult.ok) throw stakeResult.error;

const { srcChainTxHash, dstChainTxHash } = stakeResult.value;
```

### Full unstake + claim flow

```typescript
// Unstake (starts waiting period)
const unstakeResult = await sodax.staking.unstake({
  params: { srcChainKey: ChainKeys.BASE_MAINNET, srcAddress, amount, action: 'unstake' },
  raw: false,
  walletProvider: evmWalletProvider,
});

// ... wait for unstaking period ...

// Preview claimable amount with penalty info
const penaltyResult = await sodax.staking.getUnstakingInfoWithPenalty(srcAddress, ChainKeys.BASE_MAINNET);
if (penaltyResult.ok) {
  for (const req of penaltyResult.value.requestsWithPenalty) {
    // Claim with the pre-computed claimable amount
    await sodax.staking.claim({
      params: {
        srcChainKey: ChainKeys.BASE_MAINNET,
        srcAddress,
        requestId: req.id,
        amount: req.claimableAmount,
        action: 'claim',
      },
      raw: false,
      walletProvider: evmWalletProvider,
    });
  }
}
```

## Supported Chains

All staking operations accept any `SpokeChainKey` as the source chain. The hub chain (Sonic,
`ChainKeys.SONIC_MAINNET`) may also be used as the source — in that case, spoke and hub tx hashes are
identical. Example chains:

- EVM spoke chains: `ChainKeys.BASE_MAINNET`, `ChainKeys.ETHEREUM_MAINNET`, `ChainKeys.ARBITRUM_MAINNET`, etc.
- Hub chain: `ChainKeys.SONIC_MAINNET`
- Non-EVM chains: `ChainKeys.ICON_MAINNET`, `ChainKeys.SUI_MAINNET`, `ChainKeys.STELLAR_MAINNET`, etc.

Approval support: EVM spoke chains, hub chain, and Stellar only. All other non-EVM chains do not require
on-chain approval.

## Penalty System

The staking system includes a penalty mechanism for early unstaking:

- **`minUnstakingPeriod`** — maximum penalty applies if claiming before this time elapses.
- **`unstakingPeriod`** — no penalty once this full period elapses.
- **Linear reduction** — penalty decreases linearly between `minUnstakingPeriod` and `unstakingPeriod`.

Use `getStakingConfig` to read the current parameters, and `getUnstakingInfoWithPenalty` to see the
exact penalty for each pending request.

## Instant Unstaking

Instant unstaking allows users to immediately receive SODA tokens in exchange for xSoda shares, bypassing
the waiting period, but receiving a reduced amount due to the immediate-liquidity mechanism. The actual
amount received depends on current pool conditions and is estimated by `getInstantUnstakeRatio`.

Always call `getInstantUnstakeRatio` before `instantUnstake` to set an appropriate `minAmount` slippage
guard.
