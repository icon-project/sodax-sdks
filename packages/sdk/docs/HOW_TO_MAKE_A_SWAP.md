# How to Make a Swap

This guide provides a step-by-step walkthrough for executing a cross-chain swap using the Sodax SDK. It covers everything from initializing the SDK to handling errors during the swap process.

For detailed API reference, see [SWAPS.md](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/SWAPS.md).

**Example Source Code**: A complete working example can be found in [`apps/node/src/swap.ts`](https://github.com/icon-project/sodax-frontend/blob/main/apps/node/src/swap.ts). This example demonstrates a full swap implementation from Arbitrum ETH to Polygon POL, including all error handling and status polling.

## Prerequisites

Before you begin, ensure you have:

- A wallet provider implementation (e.g., `IEvmWalletProvider` for EVM chains). You can use existing wallet provider implementations from the [`@sodax/wallet-sdk-core`](https://www.npmjs.com/package/@sodax/wallet-sdk-core) npm package, or use the local package [@wallet-sdk-core](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-core/README.md) if working within the Sodax monorepo.
- The `@sodax/sdk` package installed
- Sufficient token balance to cover the swap amount and fees
- RPC URLs for the chains you're interacting with (we recommend having a dedicated node provider like Alchemy, Quicknode, etc.)
- Private key or wallet (browser) connection for signing transactions. For React applications, you can use the [`@sodax/wallet-sdk-react`](https://www.npmjs.com/package/@sodax/wallet-sdk-react) npm package, or use the local package [@wallet-sdk-react](https://github.com/icon-project/sodax-frontend/blob/main/packages/wallet-sdk-react/README.md) if working within the Sodax monorepo.

## Step 1: Initialize Sodax Instance

First, create and initialize a Sodax instance. The Sodax constructor defaults to mainnet configuration, so no configuration is required for basic usage.

```typescript
import { Sodax } from "@sodax/sdk";

// Create Sodax instance (defaults to mainnet configs)
const sodax = new Sodax();

// Initialize to fetch latest configuration from the backend API (optional, use version-based
// approach without initialize for more stability).
// Initialization fetches the latest configuration from the backend API, including supported
// tokens and chains. This ensures you have the most up-to-date token and chain information.
const initResult = await sodax.initialize();
if (!initResult.ok) {
  console.warn('Initialization failed, using packaged defaults:', initResult.error);
  // The SDK continues to work with built-in default config — this is non-fatal.
}
```

**Note**:

- The `new Sodax()` constructor defaults to mainnet configuration automatically. No configuration is required for basic usage.
- `initialize()` returns `Promise<Result<void>>`. If it fails the SDK falls back to the configuration packaged with the SDK version you installed.
- If you skip `initialize()`, the SDK will use the configuration from the specific SDK version you're using. Initialization is recommended for production applications to ensure you have the latest supported tokens and chains.

### Optional: Custom Configuration

If you need to use custom solver configuration or hub provider settings, you can pass them when creating the Sodax instance:

```typescript
import { Sodax, getSolverConfig, getHubChainConfig, ChainKeys } from "@sodax/sdk";

const sodax = new Sodax({
  swap: getSolverConfig(ChainKeys.SONIC_MAINNET), // Custom solver config
  hubProviderConfig: {
    hubRpcUrl: 'https://rpc.soniclabs.com',
    chainConfig: getHubChainConfig(),
  },
});

const initResult = await sodax.initialize();
if (!initResult.ok) {
  console.warn('Initialization failed, using packaged defaults:', initResult.error);
}
```

## Step 2: Obtain a Wallet Provider

The SDK does not require you to construct a spoke provider object. Instead, you supply a wallet provider directly in each service call. The `srcChainKey` field in the call params tells the SDK which chain to route to, and the `walletProvider` field is type-narrowed to the correct interface for that chain.

**Note**: For Node.js environments, we suggest you provide RPC URLs when creating wallet providers (default public ones might not work). For browser environments, wallet providers are typically injected by wallet extensions.

For EVM chains (Arbitrum, Polygon, BSC, etc.):

```typescript
import {
  ChainKeys,
  type IEvmWalletProvider,
  type Hex
} from "@sodax/sdk";
import { EvmWalletProvider } from "@sodax/wallet-sdk-core";

const evmWalletProvider: IEvmWalletProvider = new EvmWalletProvider({
  privateKey: '0x...' as Hex, // Your private key
  chainId: ChainKeys.ARBITRUM_MAINNET,
  rpcUrl: 'https://arb1.arbitrum.io/rpc', // Arbitrum RPC URL
});

// For browser: use the injected wallet provider from wallet extension or
// the @sodax/wallet-sdk-react package.
// const evmWalletProvider: IEvmWalletProvider = /* injected by wallet */;
```

**Important**: For the Sonic hub chain, pass an EVM wallet provider as well — Sonic is an EVM chain. The SDK distinguishes hub-vs-spoke behavior internally via `srcChainKey`.

### Getting Supported Tokens

Before creating a swap, you may want to check which tokens are supported for swaps on each chain:

```typescript
// Get all supported swap tokens for a specific chain
const supportedTokens = sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.ARBITRUM_MAINNET);
console.log('Supported tokens on Arbitrum:', supportedTokens);

// Get all supported swap tokens across all chains
const allSupportedTokens = sodax.swaps.getSupportedSwapTokens();
console.log('All supported tokens:', allSupportedTokens);

// Each token object contains address, decimals, symbol, etc.
supportedTokens.forEach(token => {
  console.log(`Token: ${token.symbol}, Address: ${token.address}, Decimals: ${token.decimals}`);
});
```

## Step 3: Get a Quote (Optional but Recommended)

Before executing a swap, it is good practice to get a quote to show users the expected output amount. This helps set proper expectations and allows you to calculate slippage tolerance.

**Example**: See how quotes are obtained in the example file: [`apps/node/src/swap.ts`](https://github.com/icon-project/sodax-frontend/blob/main/apps/node/src/swap.ts#L62-L80).

```typescript
import {
  ChainKeys,
  spokeChainConfig,
  type SolverIntentQuoteRequest
} from "@sodax/sdk";

// Get native token addresses from chain configuration
const arbEthToken = spokeChainConfig[ChainKeys.ARBITRUM_MAINNET].nativeToken; // ETH on Arbitrum
const polygonPolToken = spokeChainConfig[ChainKeys.POLYGON_MAINNET].nativeToken; // POL on Polygon

// Amount to swap — IMPORTANT: Amount must be in the token's smallest unit.
// For example, ETH has 18 decimals, so 0.0001 ETH = 100000000000000n (0.0001 * 10^18).
const inputAmount = 100000000000000n; // 0.0001 ETH (18 decimals)

const quoteRequest = {
  token_src: arbEthToken,
  token_dst: polygonPolToken,
  token_src_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
  token_dst_blockchain_id: ChainKeys.POLYGON_MAINNET,
  amount: inputAmount,
  quote_type: 'exact_input',
} satisfies SolverIntentQuoteRequest;

const quoteResult = await sodax.swaps.getQuote(quoteRequest);

if (!quoteResult.ok) {
  console.error('Failed to get quote:', quoteResult.error);
  // Handle error — could be no path found, invalid tokens, etc.
} else {
  const { quoted_amount } = quoteResult.value;
  console.log('Quoted output amount:', quoted_amount);
  // Use quoted_amount to set minOutputAmount in your intent params
}
```

## Step 4: Check Token Allowance

Before creating a swap intent, check whether the Asset Manager contract already has permission to spend your tokens. If not, you will need to approve it first.

**Example**: See how allowance checking is implemented in the example file: [`apps/node/src/swap.ts`](https://github.com/icon-project/sodax-frontend/blob/main/apps/node/src/swap.ts#L82-L112).

```typescript
import type { CreateIntentParams } from "@sodax/sdk";

const walletAddress = await evmWalletProvider.getWalletAddress();

// Prepare intent parameters (we'll complete this in Step 6)
const createIntentParams: CreateIntentParams<typeof ChainKeys.ARBITRUM_MAINNET> = {
  inputToken: arbEthToken,
  outputToken: polygonPolToken,
  inputAmount: inputAmount,
  minOutputAmount: 900000n, // Minimum output you're willing to accept
  deadline: 0n, // 0 = no deadline, or use sodax.swaps.getSwapDeadline() for a time-bounded deadline
  allowPartialFill: false,
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  dstChainKey: ChainKeys.POLYGON_MAINNET,
  srcAddress: walletAddress,
  dstAddress: walletAddress, // Destination address (where output tokens are delivered)
  solver: '0x0000000000000000000000000000000000000000', // address(0) = any solver
  data: '0x',
};

// Check if approval is needed.
// isAllowanceValid accepts the same SwapActionParams shape as swap() / createIntent().
const allowanceResult = await sodax.swaps.isAllowanceValid({
  params: createIntentParams,
  walletProvider: evmWalletProvider,
});

if (!allowanceResult.ok) {
  console.error('Failed to check allowance:', allowanceResult.error);
  // Handle error — could be network issue, invalid token, etc.
} else if (!allowanceResult.value) {
  console.log('Approval required. Proceeding to Step 5...');
} else {
  console.log('Allowance is sufficient. Proceeding to Step 6...');
}
```

**Note on field names**: `CreateIntentParams` uses `srcChainKey` and `dstChainKey` (not `srcChain` / `dstChain`). The on-chain `Intent` type has `Intent.srcChain` / `Intent.dstChain` as bigint relay chain IDs — these are internal identifiers and should not be confused with the user-facing chain key fields.

## Step 5: Approve Tokens (If Needed)

If the allowance check returned `false`, approve the Asset Manager contract to spend your tokens. The approval amount matches the `inputAmount` in your intent parameters (fees are automatically deducted from this amount).

**Example**: See how token approval is handled in the example file: [`apps/node/src/swap.ts`](https://github.com/icon-project/sodax-frontend/blob/main/apps/node/src/swap.ts#L114-L135).

```typescript
if (!allowanceResult.value) {
  console.log('Approving tokens...');

  const approveResult = await sodax.swaps.approve({
    params: createIntentParams,
    walletProvider: evmWalletProvider,
  });

  if (!approveResult.ok) {
    console.error('Failed to approve tokens:', approveResult.error);
    return; // Stop execution if approval fails
  }

  const approvalTxHash = approveResult.value;
  console.log('Approval transaction hash:', approvalTxHash);

  // IMPORTANT: Wait for the approval transaction to be confirmed before proceeding.
  await evmWalletProvider.waitForTransactionReceipt(approvalTxHash);
  console.log('Approval confirmed. Proceeding with swap...');
}
```

**Important**: Always wait for the approval transaction to be confirmed before proceeding with the swap.

**Raw mode**: `approve` also supports `raw: true` to return the unsigned transaction payload instead of broadcasting:

```typescript
const rawApproveResult = await sodax.swaps.approve({
  params: createIntentParams,
  raw: true,
  // walletProvider must be omitted when raw: true
});
```

## Step 6: Prepare Intent Parameters

Now that you have approval (if needed), prepare the complete intent parameters. Make sure to:

- Use the quoted amount from Step 3 to set a reasonable `minOutputAmount`
- Set an appropriate `deadline` (or use `0n` for no deadline / limit-order behavior)
- Ensure `srcAddress` matches your wallet address
- Set `dstAddress` to where you want to receive the output tokens

```typescript
// Optionally get a deadline (5 minutes from now by default)
const deadlineResult = await sodax.swaps.getSwapDeadline(); // or use 0n for no deadline
if (!deadlineResult.ok) {
  console.error('Failed to get deadline:', deadlineResult.error);
  return;
}
const deadline = deadlineResult.value;

// Prepare complete intent parameters
const createIntentParams: CreateIntentParams<typeof ChainKeys.ARBITRUM_MAINNET> = {
  inputToken: arbEthToken,
  outputToken: polygonPolToken,
  inputAmount: inputAmount,
  minOutputAmount: 900000n, // Minimum output (should be based on quote from Step 3)
  deadline: deadline,        // or 0n for no deadline
  allowPartialFill: false,   // Set to true to allow partial fills
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  dstChainKey: ChainKeys.POLYGON_MAINNET,
  srcAddress: walletAddress, // Must match your wallet address
  dstAddress: walletAddress, // Where to receive output tokens
  solver: '0x0000000000000000000000000000000000000000', // address(0) = any solver
  data: '0x', // Additional arbitrary data
};
```

## Step 7: Execute the Swap

Now you're ready to execute the swap. The `swap` method orchestrates the complete lifecycle automatically:

1. Creates the intent deposit transaction on the source chain
2. Verifies the spoke transaction landed on-chain
3. Submits the transaction to the relayer and waits for the relay packet to land on the hub (Sonic). This step is skipped when `srcChainKey` is the hub itself.
4. Calls `postExecution` to notify the solver, triggering it to fill the intent

**Example**: See how the swap is executed in the example file: [`apps/node/src/swap.ts`](https://github.com/icon-project/sodax-frontend/blob/main/apps/node/src/swap.ts#L137-L183).

```typescript
const swapResult = await sodax.swaps.swap({
  params: createIntentParams,
  walletProvider: evmWalletProvider,
  // Optional parameters:
  // timeout: 120000, // Timeout in milliseconds waiting for hub relay (default: 60 s)
  // skipSimulation: false, // Whether to skip transaction simulation (default: false)
});

if (!swapResult.ok) {
  // Handle error — see Step 9 for detailed error handling
  console.error('Swap failed:', swapResult.error.message);
} else {
  const { solverExecutionResponse, intent, intentDeliveryInfo } = swapResult.value;

  console.log('Swap successful!');
  console.log('Solver execution response:', solverExecutionResponse);
  console.log('Intent:', intent);
  console.log('Source transaction hash:', intentDeliveryInfo.srcTxHash);
  console.log('Destination transaction hash:', intentDeliveryInfo.dstTxHash);

  // Use intentDeliveryInfo.dstTxHash to poll for solver fill status (Step 8)
}
```

## Step 8: Check Intent Status

After a successful swap submission, continuously monitor the intent status until it reaches a terminal state. Poll every 5 seconds until the swap is completed, failed, or not found.

**Example**: See the complete status polling implementation in the example file: [`apps/node/src/swap.ts`](https://github.com/icon-project/sodax-frontend/blob/main/apps/node/src/swap.ts#L189-L289).

```typescript
import type { SolverIntentStatusRequest, SolverIntentStatusCode } from "@sodax/sdk";

/**
 * Polls the solver API until the intent reaches a terminal state.
 * Pass the hub-chain (destination) tx hash from the swap result.
 */
async function checkIntentStatus(
  sodax: Sodax,
  dstTxHash: string,
  maxAttempts = 60,
  intervalMs = 5000,
): Promise<void> {
  const statusRequest: SolverIntentStatusRequest = {
    intent_tx_hash: dstTxHash as `0x${string}`,
  };

  let attempt = 0;
  let lastStatus: SolverIntentStatusCode | null = null;
  let notFoundCount = 0;

  while (attempt < maxAttempts) {
    attempt++;
    const statusResult = await sodax.swaps.getStatus(statusRequest);

    if (!statusResult.ok) {
      console.error(`[Attempt ${attempt}] Failed to check intent status:`, statusResult.error);
      // Continue polling — may be a transient API issue
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }

    const { status, fill_tx_hash } = statusResult.value;

    if (status === SolverIntentStatusCode.SOLVED) {
      console.log(`[Attempt ${attempt}] Status: Swap completed successfully!`);
      if (fill_tx_hash) {
        console.log(`Fill transaction hash: ${fill_tx_hash}`);
      }
      return;
    }

    if (status === SolverIntentStatusCode.FAILED) {
      console.log(`[Attempt ${attempt}] Status: Swap failed`);
      return;
    }

    if (status === SolverIntentStatusCode.NOT_FOUND) {
      notFoundCount++;
      if (notFoundCount >= 3) {
        console.log(`[Attempt ${attempt}] Intent not found after ${notFoundCount} attempts. Check tx hash manually.`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }

    if (status !== lastStatus) {
      switch (status) {
        case SolverIntentStatusCode.NOT_STARTED_YET:
          console.log(`[Attempt ${attempt}] Status: Intent queued, waiting to be processed`);
          break;
        case SolverIntentStatusCode.STARTED_NOT_FINISHED:
          console.log(`[Attempt ${attempt}] Status: Intent is being processed`);
          break;
        default:
          console.log(`[Attempt ${attempt}] Unknown status (${status})`);
          return;
      }
      lastStatus = status;
    } else {
      console.log(`[Attempt ${attempt}] Still processing... (status: ${status})`);
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  console.log(`Status polling reached maximum attempts (${maxAttempts}).`);
  console.log(`Last known status: ${lastStatus ?? 'unknown'}`);
  console.log(`Check manually using destination tx hash: ${dstTxHash}`);
}

// After successful swap, start polling for status
await checkIntentStatus(sodax, intentDeliveryInfo.dstTxHash);
```

**Status Codes**:

- `NOT_FOUND (-1)`: Intent not found in the solver system (may appear immediately after creation). After 3 consecutive NOT_FOUND responses, polling stops.
- `NOT_STARTED_YET (1)`: Intent is queued and waiting to be processed (continues polling)
- `STARTED_NOT_FINISHED (2)`: Intent is currently being processed (continues polling)
- `SOLVED (3)`: Swap completed successfully (includes `fill_tx_hash` when available) — **Terminal state**
- `FAILED (4)`: Swap failed to complete — **Terminal state**

**Polling Behavior**:

- Polls every 5 seconds (configurable via `intervalMs` parameter)
- Continues until a terminal state is reached (SOLVED, FAILED, or NOT_FOUND after 3 attempts)
- Maximum polling duration: 5 minutes by default (60 attempts × 5 seconds, configurable via `maxAttempts`)
- Handles temporary API errors gracefully by continuing to poll

**Note**: The `fill_tx_hash` field is only present when the status is `SOLVED (3)`. This is the transaction hash of the fill transaction on the destination chain.

## Step 9: Handle Errors

All swap methods return `Result<T>`. When `result.ok === false`, inspect `result.error`:

- `result.error.message` carries a phase tag (`SCREAMING_SNAKE_CASE`) when the failure originated in a `catch` block during a multi-step operation.
- `result.error.cause` (ES2022 `Error.cause`) holds the underlying error when one exists.
- Precondition failures (invalid chain keys, unsupported tokens) carry a prose message without a `.cause`.

**Example**: See how errors are handled in the example file: [`apps/node/src/swap.ts`](https://github.com/icon-project/sodax-frontend/blob/main/apps/node/src/swap.ts#L144-L170).

```typescript
if (!swapResult.ok) {
  const error = swapResult.error;

  if (error instanceof Error) {
    switch (error.message) {
      case 'POST_EXECUTION_FAILED':
        // Intent was relayed to the hub, but the solver API call failed.
        // The intent may be live on the hub — check status manually and retry postExecution.
        console.error('Post execution failed. Underlying cause:', error.cause);
        break;

      case 'RELAY_TIMEOUT':
        // Spoke transaction was submitted to the relayer but the hub packet did not arrive
        // within the configured timeout. The relay may still complete — poll the relayer API.
        console.error('Relay timed out waiting for hub confirmation. Cause:', error.cause);
        break;

      case 'SUBMIT_TX_FAILED':
        // CRITICAL: The intent transaction was created on-chain but failed to reach the
        // relayer API. The user's funds are locked until you successfully re-submit.
        // Retry submitIntent() with the spoke tx hash and store it for recovery.
        console.error('Submit to relayer failed. Cause:', error.cause);
        // Retry manually:
        // const retryResult = await sodax.swaps.submitIntent({
        //   action: 'submit',
        //   params: {
        //     chain_id: getIntentRelayChainId(createIntentParams.srcChainKey).toString(),
        //     tx_hash: spokeTxHash,
        //   },
        // });
        break;

      default:
        // Precondition failure (unsupported token, invalid chain key, etc.) or unknown error
        console.error('Swap error:', error.message, error.cause ?? '');
    }
  } else {
    console.error('Non-Error failure:', error);
  }
}
```

**Note**: There are no module-specific error type guards (such as `isIntentCreationFailedError`, `isIntentSubmitTxFailedError`, etc.) in the v2 SDK. Branch on `error.message` instead as shown above.

## Complete Example

Here's a complete end-to-end example combining all the steps. For a production-ready implementation, see the example source code in [`apps/node/src/swap.ts`](https://github.com/icon-project/sodax-frontend/blob/main/apps/node/src/swap.ts):

```typescript
import {
  Sodax,
  ChainKeys,
  spokeChainConfig,
  type CreateIntentParams,
  type SolverIntentQuoteRequest,
  type SolverIntentStatusRequest,
  SolverIntentStatusCode,
  type IEvmWalletProvider
} from "@sodax/sdk";

async function executeSwap(
  evmWalletProvider: IEvmWalletProvider,
  inputAmount: bigint
): Promise<void> {
  try {
    // Step 1: Initialize Sodax
    console.log('Step 1: Initializing Sodax...');
    const sodax = new Sodax();
    const initResult = await sodax.initialize();
    if (!initResult.ok) {
      console.warn('Initialization failed, using packaged defaults:', initResult.error);
    }

    // Get native token addresses from chain configuration
    const arbEthToken = spokeChainConfig[ChainKeys.ARBITRUM_MAINNET].nativeToken; // ETH on Arbitrum
    const polygonPolToken = spokeChainConfig[ChainKeys.POLYGON_MAINNET].nativeToken; // POL on Polygon

    // Step 2: Get Quote
    console.log('Step 2: Getting quote...');
    const quoteRequest: SolverIntentQuoteRequest = {
      token_src: arbEthToken,
      token_dst: polygonPolToken,
      token_src_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
      token_dst_blockchain_id: ChainKeys.POLYGON_MAINNET,
      amount: inputAmount,
      quote_type: 'exact_input',
    };

    const quoteResult = await sodax.swaps.getQuote(quoteRequest);
    if (!quoteResult.ok) {
      console.error('Failed to get quote:', quoteResult.error);
      return;
    }

    const quotedAmount = quoteResult.value.quoted_amount;
    console.log('Quoted amount:', quotedAmount);

    // Step 3: Prepare intent parameters
    const walletAddress = await evmWalletProvider.getWalletAddress();
    const deadlineResult = await sodax.swaps.getSwapDeadline(300n); // 5 minutes
    if (!deadlineResult.ok) {
      console.error('Failed to compute deadline:', deadlineResult.error);
      return;
    }

    const createIntentParams: CreateIntentParams<typeof ChainKeys.ARBITRUM_MAINNET> = {
      inputToken: arbEthToken,
      outputToken: polygonPolToken,
      inputAmount: inputAmount,
      minOutputAmount: (quotedAmount * 95n) / 100n, // 5% slippage tolerance
      deadline: deadlineResult.value,
      allowPartialFill: false,
      srcChainKey: ChainKeys.ARBITRUM_MAINNET,
      dstChainKey: ChainKeys.POLYGON_MAINNET,
      srcAddress: walletAddress,
      dstAddress: walletAddress,
      solver: '0x0000000000000000000000000000000000000000',
      data: '0x',
    };

    // Step 4: Check Allowance
    console.log('Step 4: Checking allowance...');
    const allowanceResult = await sodax.swaps.isAllowanceValid({
      params: createIntentParams,
      walletProvider: evmWalletProvider,
    });

    if (!allowanceResult.ok) {
      console.error('Failed to check allowance:', allowanceResult.error);
      return;
    }

    // Step 5: Approve if Needed
    if (!allowanceResult.value) {
      console.log('Step 5: Approving tokens...');
      const approveResult = await sodax.swaps.approve({
        params: createIntentParams,
        walletProvider: evmWalletProvider,
      });

      if (!approveResult.ok) {
        console.error('Failed to approve tokens:', approveResult.error);
        return;
      }

      const approvalTxHash = approveResult.value;
      console.log('Approval transaction hash:', approvalTxHash);

      // Wait for approval confirmation
      await evmWalletProvider.waitForTransactionReceipt(approvalTxHash);
      console.log('Approval confirmed');
    } else {
      console.log('Step 5: Approval not needed');
    }

    // Step 6: Execute Swap
    console.log('Step 6: Executing swap...');
    const swapResult = await sodax.swaps.swap({
      params: createIntentParams,
      walletProvider: evmWalletProvider,
    });

    // Step 7: Handle Swap Result
    if (!swapResult.ok) {
      const error = swapResult.error;
      console.error('Swap failed');

      if (error instanceof Error) {
        switch (error.message) {
          case 'POST_EXECUTION_FAILED':
            console.error('Post execution failed. Cause:', error.cause);
            break;
          case 'RELAY_TIMEOUT':
            console.error('Hub relay timed out. Cause:', error.cause);
            break;
          default:
            console.error('Error:', error.message, error.cause ?? '');
        }
      } else {
        console.error('Non-Error failure:', error);
      }
      return;
    }

    // Success!
    const { solverExecutionResponse, intent, intentDeliveryInfo } = swapResult.value;
    console.log('Step 7: Swap transaction submitted successfully!');
    console.log('Solver execution response:', solverExecutionResponse);
    console.log('Intent:', intent);
    console.log('Source transaction hash:', intentDeliveryInfo.srcTxHash);
    console.log('Destination transaction hash:', intentDeliveryInfo.dstTxHash);

    // Step 8: Check Intent Status (with continuous polling)
    console.log('Step 8: Checking intent status...');
    await checkIntentStatus(sodax, intentDeliveryInfo.dstTxHash);
  } catch (error) {
    console.error('Unexpected error during swap:', error);
  }
}

/**
 * Polls the solver API until the intent reaches a terminal state.
 * Pass the hub-chain (destination) tx hash from the swap result.
 */
async function checkIntentStatus(
  sodax: Sodax,
  dstTxHash: string,
  maxAttempts = 60,
  intervalMs = 5000,
): Promise<void> {
  const statusRequest: SolverIntentStatusRequest = {
    intent_tx_hash: dstTxHash as `0x${string}`,
  };

  let attempt = 0;
  let lastStatus: SolverIntentStatusCode | null = null;
  let notFoundCount = 0;

  while (attempt < maxAttempts) {
    attempt++;
    const statusResult = await sodax.swaps.getStatus(statusRequest);

    if (!statusResult.ok) {
      console.error(`[Attempt ${attempt}] Failed to check intent status:`, statusResult.error);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }

    const { status, fill_tx_hash } = statusResult.value;

    if (status === SolverIntentStatusCode.SOLVED) {
      console.log(`[Attempt ${attempt}] Swap completed successfully!`);
      if (fill_tx_hash) {
        console.log(`Fill transaction hash: ${fill_tx_hash}`);
      }
      return;
    }

    if (status === SolverIntentStatusCode.FAILED) {
      console.log(`[Attempt ${attempt}] Swap failed`);
      return;
    }

    if (status === SolverIntentStatusCode.NOT_FOUND) {
      notFoundCount++;
      if (notFoundCount >= 3) {
        console.log(`[Attempt ${attempt}] Intent not found after ${notFoundCount} attempts. Check tx hash manually.`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }

    if (status !== lastStatus) {
      switch (status) {
        case SolverIntentStatusCode.NOT_STARTED_YET:
          console.log(`[Attempt ${attempt}] Intent queued, waiting to be processed`);
          break;
        case SolverIntentStatusCode.STARTED_NOT_FINISHED:
          console.log(`[Attempt ${attempt}] Intent is being processed`);
          break;
        default:
          console.log(`[Attempt ${attempt}] Unknown status (${status})`);
          return;
      }
      lastStatus = status;
    } else {
      console.log(`[Attempt ${attempt}] Still processing... (status: ${status})`);
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  console.log(`Status polling reached maximum attempts (${maxAttempts}).`);
  console.log(`Last known status: ${lastStatus ?? 'unknown'}`);
  console.log(`Check manually using destination tx hash: ${dstTxHash}`);
}

// Usage
await executeSwap(evmWalletProvider, 100000000000000n); // 0.0001 ETH
```

## Next Steps

- **See the complete example**: Check out the working implementation in [`apps/node/src/swap.ts`](https://github.com/icon-project/sodax-frontend/blob/main/apps/node/src/swap.ts) for a production-ready swap example
- Learn more about swap configuration and advanced features in [SWAPS.md](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/SWAPS.md)
- Explore other SDK features like [Money Market](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/MONEY_MARKET.md), [Bridge](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/BRIDGE.md), and [Staking](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/STAKING.md)
- Check the [README.md](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/README.md) for general SDK usage and configuration
- Read [ARCHITECTURE_REFACTOR_SUMMARY.md](https://github.com/icon-project/sodax-frontend/blob/main/packages/sdk/docs/ARCHITECTURE_REFACTOR_SUMMARY.md) for the full architecture reference
