# Money Market

Money Market part of SDK provides abstractions to assist you with interacting with the cross-chain Money Market Smart Contracts.

All money market operations are accessed through the `moneyMarket` property of a `Sodax` instance:

```typescript
import { Sodax, ChainKeys } from '@sodax/sdk';

const sodax = new Sodax();

// All money market methods are available through sodax.moneyMarket
const supplyResult = await sodax.moneyMarket.supply({
  params: {
    srcChainKey: ChainKeys.BSC_MAINNET,
    srcAddress: '0x...',
    token: '0x...',
    amount: 1000n,
    action: 'supply',
  },
  raw: false,
  walletProvider: evmWalletProvider,
});
```

## Using SDK Config and Constants

SDK includes predefined configurations of supported chains, tokens and other relevant information for the client to consume. All configurations are accessible through the `config` property of the Sodax instance (`sodax.config`), or through service-specific properties for convenience.

**IMPORTANT**: If you want dynamic (backend API based - contains latest tokens) configuration, make sure to initialize the instance before usage:
```typescript
await sodax.config.initialize();
```
By default, configuration from the specific SDK version you are using is used.

```typescript
import { Sodax, ChainKeys, type SpokeChainKey, type Token, type Address } from '@sodax/sdk';

const sodax = new Sodax();
await sodax.config.initialize(); // Initialize for dynamic config (optional)

// All supported spoke chains (general config)
const spokeChains: SpokeChainKey[] = sodax.config.getSupportedSpokeChains();

// Get supported money market tokens for a specific chain
const supportedMoneyMarketTokens = sodax.moneyMarket.getSupportedTokensByChainId(ChainKeys.BSC_MAINNET);

// Get all supported money market tokens per chain
const allMoneyMarketTokens = sodax.moneyMarket.getSupportedTokens();

// Get all supported reserves (hub chain token addresses, i.e. money market on Sonic chain)
const supportedReserves: readonly Address[] = sodax.moneyMarket.getSupportedReserves();

// Check if token address for given spoke chain key is supported (through config service)
const isMoneyMarketSupportedToken: boolean = sodax.config.isMoneyMarketSupportedToken(ChainKeys.BSC_MAINNET, tokenAddress);

// Alternative: Access through config service
const moneyMarketTokensFromConfig = sodax.config.getSupportedMoneyMarketTokensByChainId(ChainKeys.BSC_MAINNET);
const allMoneyMarketTokensFromConfig = sodax.config.getSupportedMoneyMarketTokens();
```

Chain constants are available under the `ChainKeys` namespace (e.g. `ChainKeys.BSC_MAINNET`, `ChainKeys.SONIC_MAINNET`). The old `*_CHAIN_ID` constants have been replaced — see `packages/sdk/CHAIN_ID_MIGRATION.md` for the full rename mapping.

## Available Methods

All money market methods are accessible through `sodax.moneyMarket`:

### Token & Reserve Configuration
- `getSupportedTokensByChainId(chainKey)` - Get supported money market tokens for a specific chain
- `getSupportedTokens()` - Get all supported money market tokens per chain
- `getSupportedReserves()` - Get all supported money market reserves (hub chain addresses)

### Allowance & Approval
- `isAllowanceValid({ params })` - Check if token approval/trustline is sufficient
- `approve({ params, walletProvider, raw? })` - Approve tokens or establish Stellar trustline

### Money Market Operations
- `supply({ params, walletProvider, timeout? })` - Supply tokens (complete operation with relay)
- `createSupplyIntent({ params, walletProvider?, raw?, skipSimulation? })` - Create supply intent only
- `borrow({ params, walletProvider, timeout? })` - Borrow tokens (complete operation with relay)
- `createBorrowIntent({ params, walletProvider?, raw?, skipSimulation? })` - Create borrow intent only
- `withdraw({ params, walletProvider, timeout? })` - Withdraw tokens (complete operation with relay)
- `createWithdrawIntent({ params, walletProvider?, raw?, skipSimulation? })` - Create withdraw intent only
- `repay({ params, walletProvider, timeout? })` - Repay tokens (complete operation with relay)
- `createRepayIntent({ params, walletProvider?, raw?, skipSimulation? })` - Create repay intent only

### Gas Estimation
- `estimateGas(params)` - Estimate gas for an encoded transaction on a given spoke chain

### Data Retrieval & Formatting
- `data.getReservesList()` - Get list of all reserve addresses
- `data.getReservesData()` - Get raw aggregated reserve data
- `data.getReservesHumanized()` - Get humanized reserve data
- `data.getReserveData(asset)` - Get specific reserve data
- `data.getReserveNormalizedIncome(asset)` - Get normalized income for a specific asset (RAY precision)
- `data.getUserReservesData(spokeChainKey, userAddress)` - Get raw user reserve data
- `data.getUserReservesHumanized(spokeChainKey, userAddress)` - Get humanized user reserve data
- `data.getEModes()` - Get raw E-Mode data
- `data.getEModesHumanized()` - Get humanized E-Mode data
- `data.formatReservesUSD(request)` - Format reserves with USD conversions
- `data.formatReserveUSD(request)` - Format a single reserve with USD conversion
- `data.formatUserSummary(request)` - Format user portfolio summary with USD conversions

### Function Parameters Structure

All money market exec methods use a single `SpokeExecActionParams`-shaped object:

- **`params`**: The money market operation parameters (`MoneyMarketSupplyParams`, `MoneyMarketBorrowParams`, `MoneyMarketWithdrawParams`, or `MoneyMarketRepayParams`). Every params type carries:
  - `srcChainKey: K` — the source spoke chain (drives TypeScript narrowing of `walletProvider`)
  - `srcAddress: string` — the caller's address on the source chain
  - `token: string` — token address on the source chain (or destination chain for borrow/withdraw)
  - `amount: bigint` — amount in token's native decimals
  - `action: 'supply' | 'borrow' | 'withdraw' | 'repay'`
  - `dstChainKey?: SpokeChainKey` — optional destination chain (defaults to `srcChainKey`)
  - `dstAddress?: string` — optional destination address (defaults to `srcAddress`)
- **`walletProvider`**: The wallet provider for the source chain. Required when `raw` is `false` (or omitted); forbidden when `raw: true`. The type is automatically narrowed to the correct interface for the given `srcChainKey` (e.g. `IEvmWalletProvider` for EVM chains).
- **`raw`**: (Optional, default `false`) When `true`, returns unsigned transaction data instead of executing. When `true`, `walletProvider` must not be passed. Used in `create*Intent` and `approve` methods.
- **`skipSimulation`**: (Optional, default `false`) Skip transaction simulation before broadcast. Used in `create*Intent` methods.
- **`timeout`**: (Optional, default: `DEFAULT_RELAY_TX_TIMEOUT` = 60 seconds) Timeout in milliseconds for relay operations. Used in `supply`, `borrow`, `withdraw`, and `repay` methods.

## Allowance and Approval

Before making a money market action (supply, repay), you need to ensure the money market contract has sufficient allowance to spend your tokens. The SDK provides methods to check and set allowances for different types of spoke providers.

**Note**: For Stellar-based operations, the allowance and approval system works differently:
- **Source Chain (Stellar)**: The standard `isAllowanceValid` and `approve` methods check and establish trustlines automatically.
- **Destination Chain (Stellar)**: When Stellar is specified as the destination chain, the SDK checks both the sender's and recipient's trustlines via `isAllowanceValid`.

**Withdraw and borrow**: No on-chain approval is required for these actions. `isAllowanceValid` always returns `true` for them (though it validates the token is supported on the destination chain).

### Checking Allowance

The `isAllowanceValid` method checks if the current allowance is sufficient for the specified action:

```typescript
import { type MoneyMarketSupplyParams, ChainKeys } from '@sodax/sdk';

const supplyParams: MoneyMarketSupplyParams = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  srcAddress: '0x...', // Caller's address on the source chain
  token: '0x...', // Address of the token (spoke chain) to supply
  amount: 1000n, // Amount to supply (in token decimals)
  action: 'supply',
};

const isAllowanceValid = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams });

if (!isAllowanceValid.ok) {
  // Handle error
  return;
}

if (!isAllowanceValid.value) {
  // Need to approve — allowance is insufficient
}
```

### Setting Allowance

The `approve` method sets the allowance for the specified action. The spender address is resolved internally based on the chain:

- **EVM Spoke Chains**: The spender is the spoke asset manager contract
- **Sonic (Hub) Chain**: The spender is the user's hub router contract
- **Stellar**: Creates/updates the required trustline

```typescript
import { type MoneyMarketSupplyParams, ChainKeys } from '@sodax/sdk';

const supplyParams: MoneyMarketSupplyParams = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  srcAddress: '0x...',
  token: '0x...',
  amount: 1000n,
  action: 'supply',
};

// First check if allowance is sufficient
const isAllowanceValid = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams });

if (!isAllowanceValid.ok) {
  // Handle error
  return;
}

if (!isAllowanceValid.value) {
  // Approve — signed execution (raw: false or omitted)
  const approveResult = await sodax.moneyMarket.approve({
    params: supplyParams,
    raw: false,
    walletProvider: evmWalletProvider,
  });

  if (!approveResult.ok) {
    // Handle approval error
    return;
  }

  // Transaction hash
  const txHash = approveResult.value;
}
```

To obtain unsigned approval calldata without broadcasting:

```typescript
// Raw transaction — walletProvider must NOT be passed
const rawApproveResult = await sodax.moneyMarket.approve({
  params: supplyParams,
  raw: true,
});

if (rawApproveResult.ok) {
  const rawTx = rawApproveResult.value; // EvmRawTransaction (or chain-specific equivalent)
}
```

### Supported Actions by Provider Type

The allowance and approval system supports different actions depending on the spoke chain type:

**EVM Spoke Providers:**
- `supply` - Approves the asset manager contract to spend tokens
- `repay` - Approves the asset manager contract to spend tokens

**Sonic Spoke Provider (Hub Chain):**
- `supply` - Approves the user hub router to spend tokens
- `repay` - Approves the user hub router to spend tokens

**Stellar:**
- `supply` / `repay` / `withdraw` / `borrow` — Checks and establishes trustlines

**Borrow and withdraw on EVM/hub chains do not require approval.**

### Stellar Trustline Requirements

For Stellar-based money market operations, you need to handle trustlines differently depending on whether Stellar is the source or destination chain. See [Stellar Trustline Requirements](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/STELLAR_TRUSTLINE.md#money-market) for detailed information and code examples.

### Complete Example

Here's a complete example showing the allowance check and approval flow:

```typescript
import { type MoneyMarketSupplyParams, ChainKeys } from '@sodax/sdk';

const supplyParams: MoneyMarketSupplyParams = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  srcAddress: '0x...',
  token: '0x...',
  amount: 1000n,
  action: 'supply',
};

// Step 1: Check if allowance is sufficient
const allowanceCheck = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams });

if (!allowanceCheck.ok) {
  console.error('Allowance check failed:', allowanceCheck.error);
  return;
}

// Step 2: Approve if allowance is insufficient
if (!allowanceCheck.value) {
  console.log('Insufficient allowance, approving...');

  const approveResult = await sodax.moneyMarket.approve({
    params: supplyParams,
    raw: false,
    walletProvider: evmWalletProvider,
  });

  if (!approveResult.ok) {
    console.error('Approval failed:', approveResult.error);
    return;
  }

  console.log('Approval successful:', approveResult.value);
}

// Step 3: Now you can proceed with supply
const supplyResult = await sodax.moneyMarket.supply({
  params: supplyParams,
  raw: false,
  walletProvider: evmWalletProvider,
});

if (supplyResult.ok) {
  const { srcChainTxHash, dstChainTxHash } = supplyResult.value;
  console.log('Supply successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Supply failed:', supplyResult.error);
}
```

### Estimate Gas for Raw Transactions

The `estimateGas` method estimates gas for an already-encoded transaction on a given spoke chain. Use this after obtaining a raw transaction from a `create*Intent` or `approve` call.

```typescript
import { type MoneyMarketSupplyParams, ChainKeys } from '@sodax/sdk';

// Example: Get raw supply transaction, then estimate its gas
const supplyIntentResult = await sodax.moneyMarket.createSupplyIntent({
  params: supplyParams,
  raw: true, // walletProvider must not be passed
});

if (supplyIntentResult.ok) {
  const { tx: rawTx } = supplyIntentResult.value;

  const gasEstimate = await sodax.moneyMarket.estimateGas({
    srcChainKey: ChainKeys.BSC_MAINNET,
    // ... encoded calldata fields
  });

  if (gasEstimate.ok) {
    console.log('Estimated gas for supply:', gasEstimate.value);
  }
}
```

## Supply Tokens

Supply tokens to the money market pool. There are two methods available:

1. `supply`: Executes the spoke-side deposit, relays to the hub, and waits for the relay to settle.
2. `createSupplyIntent`: Builds (and optionally broadcasts) only the spoke-side transaction without waiting for the relay. Useful when you need manual relay control.

```typescript
import { type MoneyMarketSupplyParams, DEFAULT_RELAY_TX_TIMEOUT, ChainKeys } from '@sodax/sdk';

const supplyParams: MoneyMarketSupplyParams = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  srcAddress: '0x...',
  token: '0x...',
  amount: 1000n,
  action: 'supply',
};

// First check and set allowance if needed
const isAllowanceValid = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams });

if (!isAllowanceValid.ok) {
  console.error('Allowance check failed:', isAllowanceValid.error);
  return;
}

if (!isAllowanceValid.value) {
  const approveResult = await sodax.moneyMarket.approve({
    params: supplyParams,
    raw: false,
    walletProvider: evmWalletProvider,
  });

  if (!approveResult.ok) {
    console.error('Approval failed:', approveResult.error);
    return;
  }

  console.log('Approval transaction:', approveResult.value);
}

// Supply and relay (complete operation)
const supplyAndSubmitResult = await sodax.moneyMarket.supply({
  params: supplyParams,
  raw: false,
  walletProvider: evmWalletProvider,
  timeout: DEFAULT_RELAY_TX_TIMEOUT, // Optional: timeout in milliseconds (default: 60 seconds)
});

if (supplyAndSubmitResult.ok) {
  const { srcChainTxHash, dstChainTxHash } = supplyAndSubmitResult.value;
  console.log('Supply successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Supply failed:', supplyAndSubmitResult.error);
}

// Create supply intent only (no relay wait)
const supplyIntentResult = await sodax.moneyMarket.createSupplyIntent({
  params: supplyParams,
  raw: false,
  walletProvider: evmWalletProvider,
});

if (supplyIntentResult.ok) {
  const { tx: txHash, relayData } = supplyIntentResult.value;
  console.log('Supply intent created:', txHash);
} else {
  console.error('Supply intent creation failed:', supplyIntentResult.error);
}

// Get raw supply calldata (no wallet, no broadcast)
const rawSupplyResult = await sodax.moneyMarket.createSupplyIntent({
  params: supplyParams,
  raw: true,
});

if (rawSupplyResult.ok) {
  const { tx: rawTx, relayData } = rawSupplyResult.value;
  console.log('Raw supply tx:', rawTx);
}
```

## Borrow Tokens

Borrow tokens from the money market pool. Borrowed tokens can be delivered to a different spoke chain by specifying `dstChainKey` and `dstAddress`.

1. `borrow`: Executes the spoke-side message, relays to the hub, and waits for the relay to settle.
2. `createBorrowIntent`: Builds (and optionally broadcasts) only the spoke-side transaction without waiting for the relay.

```typescript
import { type MoneyMarketBorrowParams, DEFAULT_RELAY_TX_TIMEOUT, ChainKeys } from '@sodax/sdk';

const borrowParams: MoneyMarketBorrowParams = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  srcAddress: '0x...',
  token: '0x...', // Token address on the destination chain (defaults to srcChainKey)
  amount: 1000n,
  action: 'borrow',
  // Optional: deliver borrowed tokens to a different chain
  // dstChainKey: ChainKeys.ETHEREUM_MAINNET,
  // dstAddress: '0x...',
};

// Borrow and relay (complete operation)
const borrowAndSubmitResult = await sodax.moneyMarket.borrow({
  params: borrowParams,
  raw: false,
  walletProvider: evmWalletProvider,
  timeout: DEFAULT_RELAY_TX_TIMEOUT,
});

if (borrowAndSubmitResult.ok) {
  const { srcChainTxHash, dstChainTxHash } = borrowAndSubmitResult.value;
  console.log('Borrow successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Borrow failed:', borrowAndSubmitResult.error);
}

// Create borrow intent only (no relay wait)
const borrowIntentResult = await sodax.moneyMarket.createBorrowIntent({
  params: borrowParams,
  raw: false,
  walletProvider: evmWalletProvider,
});

if (borrowIntentResult.ok) {
  const { tx: txHash, relayData } = borrowIntentResult.value;
  console.log('Borrow intent created:', txHash);
} else {
  console.error('Borrow intent creation failed:', borrowIntentResult.error);
}
```

## Withdraw Tokens

Withdraw previously supplied tokens from the money market pool. Withdrawn tokens can be delivered to a different spoke chain by specifying `dstChainKey` and `dstAddress`.

1. `withdraw`: Executes the spoke-side message, relays to the hub, and waits for the relay to settle.
2. `createWithdrawIntent`: Builds (and optionally broadcasts) only the spoke-side transaction without waiting for the relay.

```typescript
import { type MoneyMarketWithdrawParams, DEFAULT_RELAY_TX_TIMEOUT, ChainKeys } from '@sodax/sdk';

const withdrawParams: MoneyMarketWithdrawParams = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  srcAddress: '0x...',
  token: '0x...', // Token address on the destination chain (defaults to srcChainKey)
  amount: 1000n,
  action: 'withdraw',
};

// Withdraw and relay (complete operation)
const withdrawAndSubmitResult = await sodax.moneyMarket.withdraw({
  params: withdrawParams,
  raw: false,
  walletProvider: evmWalletProvider,
  timeout: DEFAULT_RELAY_TX_TIMEOUT,
});

if (withdrawAndSubmitResult.ok) {
  const { srcChainTxHash, dstChainTxHash } = withdrawAndSubmitResult.value;
  console.log('Withdraw successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Withdraw failed:', withdrawAndSubmitResult.error);
}

// Create withdraw intent only (no relay wait)
const withdrawIntentResult = await sodax.moneyMarket.createWithdrawIntent({
  params: withdrawParams,
  raw: false,
  walletProvider: evmWalletProvider,
});

if (withdrawIntentResult.ok) {
  const { tx: txHash, relayData } = withdrawIntentResult.value;
  console.log('Withdraw intent created:', txHash);
} else {
  console.error('Withdraw intent creation failed:', withdrawIntentResult.error);
}
```

## Repay Tokens

Repay a borrowed position in the money market pool.

1. `repay`: Executes the spoke-side deposit, relays to the hub, and waits for the relay to settle.
2. `createRepayIntent`: Builds (and optionally broadcasts) only the spoke-side transaction without waiting for the relay.

```typescript
import { type MoneyMarketRepayParams, DEFAULT_RELAY_TX_TIMEOUT, ChainKeys } from '@sodax/sdk';

const repayParams: MoneyMarketRepayParams = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  srcAddress: '0x...',
  token: '0x...',
  amount: 1000n,
  action: 'repay',
};

// First check and set allowance if needed
const isAllowanceValid = await sodax.moneyMarket.isAllowanceValid({ params: repayParams });

if (!isAllowanceValid.ok) {
  console.error('Allowance check failed:', isAllowanceValid.error);
  return;
}

if (!isAllowanceValid.value) {
  const approveResult = await sodax.moneyMarket.approve({
    params: repayParams,
    raw: false,
    walletProvider: evmWalletProvider,
  });

  if (!approveResult.ok) {
    console.error('Approval failed:', approveResult.error);
    return;
  }

  console.log('Approval transaction:', approveResult.value);
}

// Repay and relay (complete operation)
const repayAndSubmitResult = await sodax.moneyMarket.repay({
  params: repayParams,
  raw: false,
  walletProvider: evmWalletProvider,
  timeout: DEFAULT_RELAY_TX_TIMEOUT,
});

if (repayAndSubmitResult.ok) {
  const { srcChainTxHash, dstChainTxHash } = repayAndSubmitResult.value;
  console.log('Repay successful:', { srcChainTxHash, dstChainTxHash });
} else {
  console.error('Repay failed:', repayAndSubmitResult.error);
}

// Create repay intent only (no relay wait)
const repayIntentResult = await sodax.moneyMarket.createRepayIntent({
  params: repayParams,
  raw: false,
  walletProvider: evmWalletProvider,
});

if (repayIntentResult.ok) {
  const { tx: txHash, relayData } = repayIntentResult.value;
  console.log('Repay intent created:', txHash);
} else {
  console.error('Repay intent creation failed:', repayIntentResult.error);
}
```

## Error Handling

All money market methods return `Promise<Result<T>>` — never throws across service boundaries:

```typescript
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error | unknown };
```

### Error Message Convention

Errors take one of two forms:

**CODE form** — for errors originating inside a `catch` block (phase failures):

```
'CREATE_SUPPLY_INTENT_FAILED'
'SUBMIT_TX_FAILED'
'RELAY_TIMEOUT'
```

These are `Error` instances whose `.message` is a `SCREAMING_SNAKE_CASE` code and whose `.cause` (when present) holds the underlying error.

**Prose form** — for precondition/invariant failures (bad params, unsupported chain, etc.):

```
'Amount must be greater than 0'
'Approve only supported for hub (Sonic), EVM spokes, and Stellar'
'Unsupported spoke chain (...) token: ...'
```

### Branching on Errors

Check `result.error.message` for CODE-form errors. There are no typed error discriminators (`MoneyMarketError<Code>`, `isMoneyMarketSubmitTxFailedError`, etc.) — those have been removed in v2.

```typescript
const result = await sodax.moneyMarket.supply({
  params: supplyParams,
  raw: false,
  walletProvider: evmWalletProvider,
});

if (!result.ok) {
  const error = result.error;

  if (error instanceof Error) {
    if (error.message === 'SUBMIT_TX_FAILED') {
      // Failed to submit the spoke chain transaction to the relay API.
      // IMPORTANT: This is a critical event. Store the relevant payload
      // (transaction hash) locally and retry submission — if the user
      // leaves the session without re-submitting, funds may get stuck.
      console.error('Submit transaction failed:', error.cause);
    } else if (error.message === 'RELAY_TIMEOUT') {
      // The transaction was submitted but the hub did not confirm in time.
      // Check the transaction status on-chain and retry with a longer timeout.
      console.error('Relay timed out:', error.cause);
    } else {
      // Precondition failure or unexpected error
      console.error('Supply failed:', error.message);
    }
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Handling Create Intent Errors

`create*Intent` methods cover only the spoke-side transaction and can fail with a corresponding intent-creation code:

```typescript
const createIntentResult = await sodax.moneyMarket.createSupplyIntent({
  params: supplyParams,
  raw: false,
  walletProvider: evmWalletProvider,
});

if (!createIntentResult.ok) {
  const error = createIntentResult.error;

  if (error instanceof Error) {
    // Common codes: 'CREATE_SUPPLY_INTENT_FAILED', 'CREATE_BORROW_INTENT_FAILED',
    //               'CREATE_WITHDRAW_INTENT_FAILED', 'CREATE_REPAY_INTENT_FAILED'
    console.error('Intent creation failed with:', error.message, error.cause);

    // Common causes:
    // - Insufficient token balance
    // - Invalid token address or unsupported chain
    // - Network issues on the spoke chain
    // - Invalid wallet address or permissions
  }
}
```

### Handling Allowance and Approval Errors

```typescript
const allowanceCheck = await sodax.moneyMarket.isAllowanceValid({ params: supplyParams });

if (!allowanceCheck.ok) {
  console.error('Allowance check failed:', allowanceCheck.error);
  // Could be: network issues, invalid params, unsupported token
}

if (!allowanceCheck.value) {
  const approveResult = await sodax.moneyMarket.approve({
    params: supplyParams,
    raw: false,
    walletProvider: evmWalletProvider,
  });

  if (!approveResult.ok) {
    console.error('Approval failed:', approveResult.error);
    // Could be: insufficient balance, network issues, wrong wallet provider
  }
}
```

### Best Practices for Error Handling

1. **Always handle `SUBMIT_TX_FAILED`**: These are critical — funds can get stuck if the spoke transaction is not successfully relayed. Store the transaction hash and retry submission.

2. **Handle `RELAY_TIMEOUT` gracefully**: The spoke transaction may have succeeded even if the timeout fires. Check on-chain status before retrying.

3. **Branch on `error.message`**: Use `instanceof Error && error.message === '<CODE>'` to branch on CODE-form errors. For cause details, access `error.cause`.

4. **Check `error.cause`**: CODE-form errors attach `{ cause: underlyingError }` (ES2022 `Error.cause`) when a lower-level error is available.

5. **Implement retry logic**: For network-related errors, use exponential back-off.

6. **Provide user feedback**: Give users clear, actionable error messages based on the error type.

7. **Monitor timeouts**: Use appropriate timeout values and inform users when operations take longer than expected.

## Data Retrieval and Formatting

The Money Market SDK provides comprehensive data retrieval and formatting capabilities through the `MoneyMarketDataService`, accessible as `sodax.moneyMarket.data`. This service allows you to fetch reserve data, user data, and format them into human-readable values with USD conversions.

### Available Data Methods

#### Reserve Data
- `getReservesList(unfiltered?)` - Get list of all reserve addresses (bnUSD debt reserve filtered by default)
- `getReservesData()` - Get raw aggregated reserve data (bigint fields)
- `getReservesHumanized()` - Get humanized reserve data with decimal strings
- `getReserveData(asset)` - Get specific reserve data for an asset
- `getReserveNormalizedIncome(asset)` - Get normalized income for a specific asset (RAY precision)

#### User Data
- `getUserReservesData(spokeChainKey, userAddress)` - Get raw user reserve data
- `getUserReservesHumanized(spokeChainKey, userAddress)` - Get humanized user reserve data

#### E-Mode Data
- `getEModes()` - Get raw E-Mode data
- `getEModesHumanized()` - Get humanized E-Mode data

### Data Formatting

#### Formatting Reserve Data
- `formatReservesUSD(request)` - Format an array of reserves with USD conversions
- `formatReserveUSD(request)` - Format a single reserve with USD conversion

#### Formatting User Data
- `formatUserSummary(request)` - Format user portfolio summary with USD conversions

**NOTE**: If you need more customized formatting, see [math-utils](https://github.com/icon-project/sodax-frontend/tree/main/packages/sdk/src/moneyMarket/math-utils).

### Complete Example: Fetching and Formatting Data

```typescript
import { ChainKeys } from '@sodax/sdk';

// Fetch reserves data
const reserves = await sodax.moneyMarket.data.getReservesHumanized();

// Format reserves with USD conversions
const formattedReserves = sodax.moneyMarket.data.formatReservesUSD(
  sodax.moneyMarket.data.buildReserveDataWithPrice(reserves),
);

// Fetch user reserves data
const userReserves = await sodax.moneyMarket.data.getUserReservesHumanized(
  ChainKeys.BSC_MAINNET,
  userAddress,
);

// Format user summary with USD conversions
const userSummary = sodax.moneyMarket.data.formatUserSummary(
  sodax.moneyMarket.data.buildUserSummaryRequest(reserves, formattedReserves, userReserves),
);

console.log('formattedReserves:', formattedReserves);
console.log('userSummary:', userSummary);
```

### Step-by-Step Data Retrieval Process

#### 1. Fetch Raw Data

```typescript
import { ChainKeys } from '@sodax/sdk';

// Get humanized reserves data (decimal strings, no bigint)
const reserves = await sodax.moneyMarket.data.getReservesHumanized();

// Get user reserves data for a specific spoke chain
const userReserves = await sodax.moneyMarket.data.getUserReservesHumanized(
  ChainKeys.BSC_MAINNET,
  userAddress,
);
```

#### 2. Build Formatting Requests

```typescript
// Build request for reserve formatting
const reserveFormatRequest = sodax.moneyMarket.data.buildReserveDataWithPrice(reserves);

// Build request for user summary formatting
const userSummaryRequest = sodax.moneyMarket.data.buildUserSummaryRequest(
  reserves,
  formattedReserves,
  userReserves,
);
```

#### 3. Format Data

```typescript
// Format reserves with USD values
const formattedReserves = sodax.moneyMarket.data.formatReservesUSD(reserveFormatRequest);

// Format user summary with USD values
const userSummary = sodax.moneyMarket.data.formatUserSummary(userSummaryRequest);
```

### Data Structure Examples

#### Formatted Reserve Data

The `formattedReserves` array entries extend the humanized reserve shape with USD-denominated fields computed by `formatReservesUSD`:

```typescript
// Key USD-formatted fields added by formatReservesUSD:
{
  // Supply / borrow APY as decimal strings
  supplyAPY: string;
  variableBorrowAPY: string;

  // USD totals as decimal strings
  totalLiquidityUSD: string;
  totalVariableDebtUSD: string;
  availableLiquidityUSD: string;

  // Utilisation as decimal string
  utilizationRate: string;

  // Price from base currency
  priceInMarketReferenceCurrency: string;
  priceInUSD: string;

  // Original humanized fields (symbol, decimals, rates as decimal strings, etc.)
  // are preserved on the same object
}
```

#### Formatted User Summary

The `userSummary` object contains the user's portfolio information:

```typescript
// Key fields in FormatUserSummaryResponse:
{
  totalCollateralUSD: string;
  totalBorrowsUSD: string;
  totalLiquidityUSD: string;
  healthFactor: string;
  availableBorrowsUSD: string;
  currentTimestamp: number;
  userEmodeCategoryId: number;
  // ... additional fields
}
```

### Utility Functions

The SDK also provides utility functions for formatting specific values:

```typescript
import { formatPercentage, formatBasisPoints } from '@sodax/sdk';

// Format RAY-precision (27 decimal) rate as a percentage string
const rateValue = 52500000000000000000000000n; // 5.25% in RAY
const formattedRate = formatPercentage(rateValue, 27); // Returns "5.25%"

// Format basis points (1 bp = 0.01%) as a percentage string
const basisPointsValue = 250n; // 250 bps = 2.50%
const formattedBasisPoints = formatBasisPoints(basisPointsValue); // Returns "2.50%"
```
