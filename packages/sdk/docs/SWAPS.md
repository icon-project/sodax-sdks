# Swaps (Solver)

The swap module provides abstractions for interacting with cross-chain Intent Smart Contracts, the Solver API, and the Relay API.

All swap operations are accessed through the `swaps` property of a `Sodax` instance:

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax();

// All swap methods are available through sodax.swaps
const quote = await sodax.swaps.getQuote(quoteRequest);
```

## Using SDK Config and Constants

The SDK includes predefined configurations of supported chains, tokens, and other relevant information.
All configurations are reachable through the `config` property of the `Sodax` instance.

```typescript
import { Sodax, ChainKeys } from '@sodax/sdk';
import type { SpokeChainKey, XToken } from '@sodax/sdk';

const sodax = new Sodax();

// If you want dynamic (backend API-based) configuration, initialize the instance before use.
// By default the configuration bundled in the SDK version you are using is applied.
await sodax.initialize();

// All supported spoke chain keys
const spokeChains: SpokeChainKey[] = sodax.config.getSupportedSpokeChains();

// Supported swap tokens for a specific spoke chain key
const supportedTokens: readonly XToken[] = sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.BSC_MAINNET);

// All supported swap tokens across every spoke chain
const allTokens: Record<SpokeChainKey, readonly XToken[]> = sodax.swaps.getSupportedSwapTokens();
```

## Available Methods

All swap methods are accessible through `sodax.swaps`:

### Quote & Fee Methods

- `getQuote(payload)` — Request a price quote from the solver API
- `getPartnerFee(inputAmount)` — Calculate the partner fee for a given input amount
- `getSolverFee(inputAmount)` — Calculate the solver protocol fee (0.1%) for a given input amount
- `getSwapDeadline(offset?)` — Compute an absolute deadline timestamp for an intent

### Intent Creation & Execution

- `swap(params)` — Full end-to-end swap (recommended — handles all steps automatically); signed execution only
- `createIntent(params)` — Create an intent on the source spoke chain; supports both signed (`raw: false`) and raw (`raw: true`) modes
- `createLimitOrder(params)` — Full end-to-end limit order (no deadline, must be cancelled manually); signed execution only
- `createLimitOrderIntent(params)` — Create a limit order intent only (no relay/solver notify); supports raw and signed modes
- `submitIntent(payload)` — Submit a spoke tx to the relay API (low-level, called automatically by `swap`)
- `postExecution(request)` — Notify the solver that an intent is live on the hub chain (low-level, called automatically by `swap`)

### Intent Management

- `getIntent(txHash)` — Retrieve an `Intent` from a hub-chain transaction hash
- `getFilledIntent(txHash)` — Retrieve the fill state of an intent from the solver's fill tx hash
- `getIntentSubmitTxExtraData(params)` — Get the relay extra data (`address` + `payload`) needed to submit a Solana/Bitcoin intent
- `getSolvedIntentPacket(params)` — Poll the relayer until a solved intent's fill packet arrives on the destination chain
- `getIntentHash(intent)` — Compute the keccak256 hash of an intent (its on-chain ID)
- `getStatus(request)` — Poll the solver API for current intent execution status
- `cancelIntent(params)` — Cancel an active intent and wait for hub confirmation
- `createCancelIntent(params)` — Build (and optionally broadcast) only the cancel tx; supports raw and signed modes
- `cancelLimitOrder(params)` — Alias for `cancelIntent` with domain-specific naming

### Token Approval

- `isAllowanceValid(params)` — Check if the spender contract has sufficient token allowance
- `approve(params)` — Approve token spend (EVM/Sonic/Stellar); supports raw and signed modes

### Utility Methods

- `getSupportedSwapTokensByChainId(chainId)` — Get supported swap tokens for a spoke chain
- `getSupportedSwapTokens()` — Get all supported swap tokens per chain
- `estimateGas(params)` — Estimate gas for a raw transaction on any spoke chain

## Core Concepts

### `srcChainKey` / `dstChainKey`

All action params use `srcChainKey` and `dstChainKey` (not `srcChain` / `dstChain`). These are `SpokeChainKey` strings from `ChainKeys.*`.

The on-chain `Intent` struct has `Intent.srcChain` / `Intent.dstChain` as `IntentRelayChainId` (bigint relay IDs) — these are different from the action param fields and should not be confused with them.

### Signed vs Raw Mode (`raw: true / false`)

Methods that accept a `raw` flag return different types depending on the value:

- **`raw: false`** (default) — requires a `walletProvider` matching the source chain type; signs and broadcasts the transaction; returns a tx hash.
- **`raw: true`** — `walletProvider` must be absent (passing one is a compile error); returns an unsigned raw transaction payload.

TypeScript enforces this at compile time via the `WalletProviderSlot<K, Raw>` discriminated union:

```typescript
// Signed execution — walletProvider required, chain-narrowed by srcChainKey
await sodax.swaps.createIntent({
  params: { srcChainKey: ChainKeys.BSC_MAINNET, ...otherParams },
  raw: false,
  walletProvider: evmWalletProvider, // must be IEvmWalletProvider for BSC
});

// Raw mode — walletProvider must be absent
await sodax.swaps.createIntent({
  params: { srcChainKey: ChainKeys.BSC_MAINNET, ...otherParams },
  raw: true,
  // walletProvider here would be a compile error
});
```

**Methods with raw support:** `createIntent`, `createLimitOrderIntent`, `createCancelIntent`, `approve`

**Methods without raw support (signed execution only):** `swap`, `createLimitOrder`, `cancelIntent`, `cancelLimitOrder`

### `ChainKeys.*` Constants

All chain identifiers come from `ChainKeys`:

```typescript
import { ChainKeys } from '@sodax/sdk';

ChainKeys.BSC_MAINNET         // '0x38.bsc'
ChainKeys.ARBITRUM_MAINNET    // '0xa4b1.arbitrum'
ChainKeys.ETHEREUM_MAINNET    // 'ethereum'
ChainKeys.SOLANA_MAINNET      // 'solana'
ChainKeys.SONIC_MAINNET       // 'sonic'  (hub chain)
```

### `Result<T>` — No Throws Across Service Boundaries

Every public async method returns `Promise<Result<T>>`:

```typescript
type Result<T, E = Error | unknown> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

Check `result.ok` before accessing `result.value` or `result.error`. Some methods return `Result<T, SolverErrorResponse>` for solver-specific failures (e.g. `getQuote`, `getStatus`, `postExecution`).

### Error Handling

There are no module-specific typed error unions (`IntentError<Code>`, etc.) — these were removed in v2. Errors fall into two categories:

1. **CODE form** (from `catch` blocks, multi-step operations): `result.error instanceof Error && result.error.message === 'PHASE_CODE'`. The underlying error is on `.cause`:

   ```typescript
   if (!result.ok && result.error instanceof Error) {
     switch (result.error.message) {
       case 'POST_EXECUTION_FAILED':
         // Solver notify step failed; check result.error.cause for the underlying error
         break;
       case 'RELAY_TIMEOUT':
         // Relay didn't confirm within the timeout
         break;
       case 'SUBMIT_TX_FAILED':
         // Relay submission failed — store the payload and retry
         break;
     }
   }
   ```

2. **Prose form** (from precondition guards): a human-readable message in `result.error.message` describing the validation failure (e.g. `'Unsupported spoke chain token'`, `'Approve only supported for hub (Sonic), EVM spokes, and Stellar'`).

---

## Request a Quote

Requesting a quote requires the user's input amount scaled by the token's decimals. All token addresses and decimals are available via `sodax.config`.

The quoting API supports `'exact_input'` (user specifies the amount to swap) and `'exact_output'` (user specifies the amount to receive).

```typescript
import { Sodax, ChainKeys } from '@sodax/sdk';
import type { SolverIntentQuoteRequest, SolverErrorResponse } from '@sodax/sdk';

const sodax = new Sodax();

const bscEthToken = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8';  // ETH on BSC
const arbWbtcToken = '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f'; // wBTC on Arbitrum

const quoteRequest = {
  token_src: bscEthToken,
  token_dst: arbWbtcToken,
  token_src_blockchain_id: ChainKeys.BSC_MAINNET,
  token_dst_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
  amount: 1_000_000_000_000_000n, // 1 WETH (18 decimals)
  quote_type: 'exact_input',
} satisfies SolverIntentQuoteRequest;

const result = await sodax.swaps.getQuote(quoteRequest);

if (result.ok) {
  const { quoted_amount } = result.value;
  console.log('Quoted amount:', quoted_amount);
} else {
  // result.error is SolverErrorResponse — check result.error.detail.code
  console.error('Quote failed:', result.error);
}
```

**Note:** `getQuote` automatically deducts the configured partner fee from `payload.amount` before forwarding to the solver, so the returned `quoted_amount` reflects the net output the user actually receives.

---

## Intent Parameters

### `CreateIntentParams<K>`

```typescript
import type { CreateIntentParams } from '@sodax/sdk';
import { ChainKeys } from '@sodax/sdk';

const createIntentParams = {
  inputToken: '0x...',           // Input token address on the source spoke chain
  outputToken: '0x...',          // Output token address on the destination spoke chain
  inputAmount: 1_000_000n,       // Gross input amount (fee will be deducted from this)
  minOutputAmount: 900_000n,     // Minimum acceptable output amount
  deadline: 0n,                  // Unix timestamp after which intent expires (0 = no expiry)
  allowPartialFill: false,       // Whether the intent can be partially filled
  srcChainKey: ChainKeys.BSC_MAINNET,       // Source chain key
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,  // Destination chain key
  srcAddress: '0x...',           // User's address on the source chain
  dstAddress: '0x...',           // Recipient address on the destination chain
  solver: '0x0000000000000000000000000000000000000000', // Specific solver (address(0) = any)
  data: '0x',                    // Additional arbitrary data
} satisfies CreateIntentParams<typeof ChainKeys.BSC_MAINNET>;
```

### `CreateLimitOrderParams<K>`

Same as `CreateIntentParams` but `deadline` is optional (it is forced to `0n` by `createLimitOrder` / `createLimitOrderIntent`):

```typescript
import type { CreateLimitOrderParams } from '@sodax/sdk';

const limitOrderParams = {
  inputToken: '0x...',
  outputToken: '0x...',
  inputAmount: 1_000_000n,
  minOutputAmount: 900_000n,
  // deadline omitted — will be set to 0n automatically
  allowPartialFill: false,
  srcChainKey: ChainKeys.BSC_MAINNET,
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcAddress: '0x...',
  dstAddress: '0x...',
  solver: '0x0000000000000000000000000000000000000000',
  data: '0x',
} satisfies CreateLimitOrderParams<typeof ChainKeys.BSC_MAINNET>;
```

---

## Get Fees

### Partner Fee

```typescript
// Calculate partner fee for a given input amount
const inputAmount = 1_000_000_000_000_000n; // 1 WETH (18 decimals)
const partnerFee = sodax.swaps.getPartnerFee(inputAmount);

console.log('Partner fee:', partnerFee);               // Returns 0n if no partner fee configured
console.log('Net swap amount:', inputAmount - partnerFee);
```

The partner fee is deducted from the input amount before the intent is created. If no partner fee is configured on the `Sodax` instance, `getPartnerFee` returns `0n`.

### Solver Fee

```typescript
// Calculate the 0.1% solver protocol fee
const inputAmount = 1_000_000_000_000_000n;
const solverFee = sodax.swaps.getSolverFee(inputAmount);

console.log('Solver fee (0.1%):', solverFee);
```

---

## Get Swap Deadline

Fetches the current hub-chain (Sonic) block timestamp and adds a deadline offset. Pass the result as `CreateIntentParams.deadline`.

```typescript
// Default 5-minute offset (DEFAULT_DEADLINE_OFFSET = 300 seconds)
const deadlineResult = await sodax.swaps.getSwapDeadline();
if (deadlineResult.ok) {
  console.log('Deadline (5 min from now):', deadlineResult.value);
}

// Custom 10-minute offset
const customDeadlineResult = await sodax.swaps.getSwapDeadline(600n); // 600 seconds
if (customDeadlineResult.ok) {
  const createIntentParams = {
    // ...
    deadline: customDeadlineResult.value,
    // ...
  };
}
```

For limit orders, pass `deadline: 0n` directly to `createIntent` (or use `createLimitOrder` / `createLimitOrderIntent` which force `0n` automatically).

---

## Token Approval Flow

Before creating an intent, check whether the relevant spender contract already has permission to spend the user's input tokens.

- **Hub (Sonic)**: checks allowance against the intents contract
- **EVM spoke chains**: checks allowance against the spoke's asset manager
- **Stellar**: checks trustline sufficiency
- **Other chains (Solana, NEAR, etc.)**: always returns `true` — no on-chain allowance concept

```typescript
import { Sodax, ChainKeys } from '@sodax/sdk';
import type { IEvmWalletProvider } from '@sodax/sdk';

// evmWalletProvider comes from wallet-sdk-core (EvmWalletProvider) or
// useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET }) from wallet-sdk-react
declare const evmWalletProvider: IEvmWalletProvider;

const createIntentParams = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  inputToken: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  inputAmount: 1_000_000n,
  srcAddress: await evmWalletProvider.getWalletAddress(),
  // ... other params
};

const allowanceResult = await sodax.swaps.isAllowanceValid({
  params: createIntentParams,
  walletProvider: evmWalletProvider,
});

if (!allowanceResult.ok) {
  console.error('Allowance check failed:', allowanceResult.error);
} else if (!allowanceResult.value) {
  // Approval needed
  const approveResult = await sodax.swaps.approve({
    params: createIntentParams,
    walletProvider: evmWalletProvider,
  });

  if (!approveResult.ok) {
    console.error('Approve failed:', approveResult.error);
  } else {
    console.log('Approval tx hash:', approveResult.value);
    // Wait for the approval tx to be mined before proceeding
  }
}
```

### Raw Approval Transaction

```typescript
// Get raw (unsigned) approval tx data — no walletProvider needed
const approveResult = await sodax.swaps.approve({
  params: createIntentParams,
  raw: true,
});

if (approveResult.ok) {
  const rawTx = approveResult.value; // EvmRawTransaction: { from, to, value, data }
  console.log('Raw approval tx:', rawTx);
}
```

### Stellar Trustline

For Stellar as the source chain, `isAllowanceValid` checks trustline balance sufficiency and `approve` adds/increases the trustline. For Stellar as the **destination** chain, frontends must manually establish trustlines before executing swaps. See `packages/sdk/docs/STELLAR_TRUSTLINE.md` for details.

---

## Estimate Gas for Raw Transactions

```typescript
import { ChainKeys } from '@sodax/sdk';
import type { EstimateGasParams } from '@sodax/sdk';

// Get a raw intent tx first
const createIntentResult = await sodax.swaps.createIntent({
  params: createIntentParams,
  raw: true,
});

if (createIntentResult.ok) {
  const { tx: rawTx } = createIntentResult.value;

  // Estimate gas — provide the chain key and the raw tx
  const gasResult = await sodax.swaps.estimateGas({
    chainKey: ChainKeys.BSC_MAINNET,
    tx: rawTx,
  } satisfies EstimateGasParams<typeof ChainKeys.BSC_MAINNET>);

  if (gasResult.ok) {
    console.log('Estimated gas:', gasResult.value);
  }
}
```

---

## Swap (Recommended)

The `swap` method is the recommended way to perform a complete cross-chain swap. It orchestrates the full lifecycle automatically:

1. Calls `createIntent` to submit the intent transaction on the source spoke chain
2. Verifies the spoke transaction landed on-chain
3. For non-hub source chains: submits the spoke tx to the relayer and waits for the relay packet to land on the hub (Sonic)
4. Calls `postExecution` to notify the solver, triggering it to fill the intent

`swap` is signed-only (no `raw: true` mode) — use `createIntent` if you need raw transaction data.

```typescript
import { Sodax, ChainKeys } from '@sodax/sdk';
import type { IEvmWalletProvider, SwapResponse } from '@sodax/sdk';

declare const evmWalletProvider: IEvmWalletProvider;

const swapResult = await sodax.swaps.swap({
  params: {
    inputToken: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
    outputToken: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    inputAmount: 1_000_000_000_000_000n,
    minOutputAmount: 900_000n,
    deadline: 300n, // or use getSwapDeadline()
    allowPartialFill: false,
    srcChainKey: ChainKeys.BSC_MAINNET,
    dstChainKey: ChainKeys.ARBITRUM_MAINNET,
    srcAddress: await evmWalletProvider.getWalletAddress(),
    dstAddress: '0x...',
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
  },
  walletProvider: evmWalletProvider,
  fee: undefined,          // optional — uses the configured partner fee if omitted
  timeout: 60_000,         // optional — relay timeout in ms (default: 60 s)
  skipSimulation: false,   // optional — skip spoke tx simulation (default: false)
});

if (!swapResult.ok) {
  // See Error Handling section for how to branch on specific error codes
  console.error('Swap failed:', swapResult.error);
} else {
  const { solverExecutionResponse, intent, intentDeliveryInfo }: SwapResponse = swapResult.value;
  console.log('Solver acknowledged:', solverExecutionResponse.answer); // 'OK'
  console.log('Hub tx hash:', intentDeliveryInfo.dstTxHash);
}
```

---

## Create Intent Only

Use `createIntent` when you need raw transaction data or want to control the relay step yourself. For the full lifecycle, prefer `swap`.

### Signed execution

```typescript
const createIntentResult = await sodax.swaps.createIntent({
  params: createIntentParams, // CreateIntentParams<typeof ChainKeys.BSC_MAINNET>
  walletProvider: evmWalletProvider,
  fee: undefined,     // optional
  skipSimulation: false, // optional
});

if (createIntentResult.ok) {
  const { tx: spokeTxHash, intent, relayData } = createIntentResult.value;
  console.log('Spoke tx hash:', spokeTxHash);
  console.log('Intent fee amount:', intent.feeAmount);
}
```

### Raw transaction

```typescript
const createIntentResult = await sodax.swaps.createIntent({
  params: createIntentParams,
  raw: true, // walletProvider must be absent
});

if (createIntentResult.ok) {
  const { tx: rawTx, intent, relayData } = createIntentResult.value;
  // rawTx is EvmRawTransaction: { from, to, value, data }
  // relayData is RelayExtraData: { address, payload } — needed for submitIntent
  console.log('Raw tx:', rawTx);
}
```

---

## Limit Orders

A limit order is an intent with `deadline = 0n` — it stays active indefinitely until filled at `minOutputAmount` or manually cancelled.

### Create Limit Order (full lifecycle)

```typescript
import type { IEvmWalletProvider } from '@sodax/sdk';

declare const evmWalletProvider: IEvmWalletProvider;

const limitOrderResult = await sodax.swaps.createLimitOrder({
  params: {
    inputToken: '0x...',
    outputToken: '0x...',
    inputAmount: 1_000_000n,
    minOutputAmount: 900_000n,
    // deadline omitted — forced to 0n
    allowPartialFill: false,
    srcChainKey: ChainKeys.BSC_MAINNET,
    dstChainKey: ChainKeys.ARBITRUM_MAINNET,
    srcAddress: '0x...',
    dstAddress: '0x...',
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
  },
  walletProvider: evmWalletProvider,
});

if (limitOrderResult.ok) {
  const { intent } = limitOrderResult.value;
  const intentHash = sodax.swaps.getIntentHash(intent);
  console.log('Limit order intent hash:', intentHash);
}
```

### Create Limit Order Intent (intent tx only — no relay/solver notify)

```typescript
// Signed
const result = await sodax.swaps.createLimitOrderIntent({
  params: limitOrderParams,
  walletProvider: evmWalletProvider,
});

// Raw
const rawResult = await sodax.swaps.createLimitOrderIntent({
  params: limitOrderParams,
  raw: true,
});
```

### Cancel Limit Order / Cancel Intent

`cancelLimitOrder` is a domain-specific alias for `cancelIntent`. Both take an object with `srcChainKey` and `intent`.

**Important:** `cancelIntent` takes `{ params: CancelIntentParams<K>, walletProvider }` — not positional arguments. You must supply `srcChainKey` explicitly because `Intent.srcChain` is a bigint relay ID that cannot narrow to a `SpokeChainKey` at the type level.

```typescript
import type { Intent, TxHashPair } from '@sodax/sdk';

// Retrieve the intent by hub-chain tx hash (or use the intent from createIntent/swap response)
const intentResult = await sodax.swaps.getIntent(hubTxHash);
if (!intentResult.ok) {
  console.error('Failed to fetch intent:', intentResult.error);
  return;
}
const intent: Intent = intentResult.value;

// Cancel the intent
const cancelResult = await sodax.swaps.cancelIntent({
  params: {
    srcChainKey: ChainKeys.BSC_MAINNET, // must match intent.srcChain
    intent,
  },
  walletProvider: evmWalletProvider,
  timeout: 60_000, // optional relay timeout (ms)
});

if (cancelResult.ok) {
  const { srcChainTxHash, dstChainTxHash }: TxHashPair = cancelResult.value;
  console.log('Cancel spoke tx:', srcChainTxHash);
  console.log('Cancel hub tx:', dstChainTxHash);
} else {
  console.error('Cancel failed:', cancelResult.error);
}
```

### Build Cancel Intent (raw or signed — no relay wait)

Use `createCancelIntent` when you need only the cancel transaction (e.g. for gas estimation or manual relay):

```typescript
// Raw cancel tx
const rawCancelResult = await sodax.swaps.createCancelIntent({
  params: { srcChainKey: ChainKeys.BSC_MAINNET, intent },
  raw: true,
});

if (rawCancelResult.ok) {
  const rawTx = rawCancelResult.value; // EvmRawTransaction
}
```

---

## Submit Intent to Relay API

Called automatically by `swap`. Use this manually if you called `createIntent` separately.

```typescript
import type { IntentRelayRequest } from '@sodax/sdk';

const submitPayload = {
  action: 'submit',
  params: {
    chain_id: '0x38.bsc', // intentRelayChainId string for the source chain
    tx_hash: spokeTxHash,
    // data: relayData, // include when srcChain is Solana or Bitcoin
  },
} satisfies IntentRelayRequest<'submit'>;

const submitResult = await sodax.swaps.submitIntent(submitPayload);

if (submitResult.ok) {
  console.log('Relay accepted:', submitResult.value.success);
} else {
  console.error('Relay submission failed:', submitResult.error);
  // IMPORTANT: Store spokeTxHash + submitPayload in local storage and retry.
  // If the user leaves before this succeeds, funds may be stuck until re-submission.
}
```

---

## Get Intent Submit Tx Extra Data

Required only when the source chain is **Solana** or **Bitcoin**. Pass the returned `RelayExtraData` as `data` in `submitIntent`.

```typescript
import type { RelayExtraData } from '@sodax/sdk';

// Option 1: derive from hub-chain tx hash
const extraDataResult = await sodax.swaps.getIntentSubmitTxExtraData({
  txHash: '0x9b8c...', // hub-chain tx hash
});

// Option 2: derive from a pre-fetched Intent
const intentResult = await sodax.swaps.getIntent(hubTxHash);
if (intentResult.ok) {
  const extraDataResult2 = await sodax.swaps.getIntentSubmitTxExtraData({
    intent: intentResult.value,
  });

  if (extraDataResult2.ok) {
    const extraData: RelayExtraData = extraDataResult2.value;
    // Use extraData.address and extraData.payload in the relay submit request
  }
}
```

---

## Post Execution to Solver API

Called automatically by `swap` after the relay packet lands on the hub. Use this manually when orchestrating the swap steps yourself.

```typescript
import type { SolverExecutionRequest } from '@sodax/sdk';

const postExecutionResult = await sodax.swaps.postExecution({
  intent_tx_hash: hubTxHash, // hub-chain (Sonic) tx hash where the intent was registered
} satisfies SolverExecutionRequest);

if (postExecutionResult.ok) {
  const { answer, intent_hash } = postExecutionResult.value;
  console.log('Solver answer:', answer);         // 'OK'
  console.log('Intent hash:', intent_hash);
} else {
  console.error('Post execution failed:', postExecutionResult.error);
}
```

---

## Get Intent

Retrieve an `Intent` from the `IntentCreated` event on the hub chain.

```typescript
import type { Intent } from '@sodax/sdk';

const intentResult = await sodax.swaps.getIntent(hubTxHash);
if (intentResult.ok) {
  const intent: Intent = intentResult.value;
  console.log('Intent ID:', intent.intentId);
  console.log('Input amount:', intent.inputAmount);
  // Note: intent.srcChain / intent.dstChain are IntentRelayChainId (bigint),
  // not SpokeChainKey strings — use them only for relay ID comparisons.
}
```

---

## Get Filled Intent

Retrieve the fill state of an intent from the `IntentFilled` event log, emitted when a solver fills an intent on the hub chain.

```typescript
import type { IntentState } from '@sodax/sdk';

const filledIntentResult = await sodax.swaps.getFilledIntent(solverFillTxHash);

if (filledIntentResult.ok) {
  const state: IntentState = filledIntentResult.value;
  console.log('Exists:', state.exists);
  console.log('Remaining input:', state.remainingInput);
  console.log('Received output:', state.receivedOutput);
  console.log('Pending payment:', state.pendingPayment);
} else {
  console.error('No IntentFilled event found in tx:', filledIntentResult.error);
}
```

**`IntentState` fields:**
- `exists` — whether the intent exists on-chain
- `remainingInput` — unfilled input amount
- `receivedOutput` — output tokens received so far
- `pendingPayment` — whether a payment is pending

---

## Get Intent Status

Poll the solver API for the current execution status of an intent. The `intent_tx_hash` must be the hub-chain tx hash where the intent was registered.

```typescript
import { SolverIntentStatusCode } from '@sodax/sdk';
import type { SolverIntentStatusRequest } from '@sodax/sdk';

const statusResult = await sodax.swaps.getStatus({
  intent_tx_hash: hubTxHash,
} satisfies SolverIntentStatusRequest);

if (statusResult.ok) {
  const { status, fill_tx_hash } = statusResult.value;
  console.log('Status:', status); // SolverIntentStatusCode enum value

  if (status === SolverIntentStatusCode.SOLVED && fill_tx_hash) {
    console.log('Fill tx hash:', fill_tx_hash);
  }
}
```

---

## Get Solved Intent Packet

Poll the relayer until the solver's fill tx has been delivered to the destination chain. Call this after `getStatus` returns `SolverIntentStatusCode.SOLVED`.

```typescript
import { Sodax, ChainKeys, SolverIntentStatusCode } from '@sodax/sdk';
import type { PacketData } from '@sodax/sdk';

const statusResult = await sodax.swaps.getStatus({ intent_tx_hash: hubTxHash });

if (statusResult.ok && statusResult.value.status === SolverIntentStatusCode.SOLVED) {
  const { fill_tx_hash } = statusResult.value;

  if (fill_tx_hash) {
    const packetResult = await sodax.swaps.getSolvedIntentPacket({
      chainId: ChainKeys.ARBITRUM_MAINNET, // destination spoke chain key
      fillTxHash: fill_tx_hash,
      timeout: 120_000, // optional, default: 120 s
    });

    if (packetResult.ok) {
      const packet: PacketData = packetResult.value;
      console.log('Dst chain tx hash:', packet.dst_tx_hash);
      console.log('Status:', packet.status);
    } else {
      // result.error.message === 'RELAY_TIMEOUT' if the packet didn't arrive in time
      console.error('Packet not delivered:', packetResult.error);
    }
  }
}
```

---

## Get Intent Hash

Compute the keccak256 hash of an intent (its unique ID on the hub chain).

```typescript
import type { Intent, Hex } from '@sodax/sdk';

const intentHash: Hex = sodax.swaps.getIntentHash(intent);
console.log('Intent hash:', intentHash);
```

---

## Error Handling

### Handling `swap` / `createLimitOrder` Errors

These methods perform multiple operations in sequence. On failure, `result.error` is an `Error` instance whose `message` identifies the failing phase:

```typescript
const swapResult = await sodax.swaps.swap({
  params: createIntentParams,
  walletProvider: evmWalletProvider,
});

if (!swapResult.ok) {
  const error = swapResult.error;

  if (error instanceof Error) {
    switch (error.message) {
      case 'POST_EXECUTION_FAILED':
        // Solver notification failed — the intent may have been created and relayed
        // successfully. Check intent status manually, then retry postExecution.
        console.error('Underlying cause:', error.cause);
        break;

      case 'RELAY_TIMEOUT':
        // Relay didn't confirm within the timeout. Check the intent status and,
        // if needed, resubmit with a longer timeout.
        console.error('Underlying cause:', error.cause);
        break;

      case 'SUBMIT_TX_FAILED':
        // CRITICAL: The spoke tx landed but relay submission failed.
        // Store spokeTxHash + submitPayload in local storage and retry promptly.
        // If the user leaves before re-submission, funds may become inaccessible.
        console.error('Underlying cause:', error.cause);
        break;

      default:
        // Precondition / validation error — human-readable prose in error.message
        console.error('Error:', error.message);
    }
  }
}
```

### Handling `createIntent` Errors

`createIntent` errors are either validation failures (prose form) or transaction failures (CODE form from the catch):

```typescript
const createIntentResult = await sodax.swaps.createIntent({
  params: createIntentParams,
  walletProvider: evmWalletProvider,
});

if (!createIntentResult.ok) {
  const error = createIntentResult.error;
  // Common causes:
  // - Insufficient token balance
  // - Unsupported token address (invariant prose error)
  // - Invalid chain key (invariant prose error)
  // - Network issues on the spoke chain
  console.error('Intent creation failed:', error);
}
```

### Solver API Errors

Methods that return `Result<T, SolverErrorResponse>` (e.g. `getQuote`, `getStatus`, `postExecution`) include a `SolverIntentErrorCode` in the error:

```typescript
import { SolverIntentErrorCode } from '@sodax/sdk';
import type { SolverErrorResponse } from '@sodax/sdk';

const quoteResult = await sodax.swaps.getQuote(quoteRequest);
if (!quoteResult.ok) {
  const solverError = quoteResult.error as SolverErrorResponse;
  console.error('Solver error code:', solverError.detail.code);    // SolverIntentErrorCode
  console.error('Solver error message:', solverError.detail.message);
}
```
