# Monetize SDK

Learn how to configure fees and monetize your Sodax SDK integration.

When using the SODAX SDK, you can monetize your integration by collecting fees from the transactions processed through your application.
Fees are configured globally per feature when creating the `Sodax` instance — there is no per-request override for `getQuote()` or `swap()`.

## Defining Fee

```typescript
import { PartnerFee } from '@sodax/sdk';

// Partner fee can be defined as a percentage or a definite token amount.
// Fee is optional, you can leave it empty/undefined.
const partnerFeePercentage = {
  address: '0x0000000000000000000000000000000000000000', // EVM (Sonic) address to receive fee
  percentage: 100, // 100 = 1%, 10000 = 100%
} satisfies PartnerFee;

const partnerFeeAmount = {
  address: '0x0000000000000000000000000000000000000000', // EVM (Sonic) address to receive fee
  amount: 1000n, // definite amount denominated in token decimal precision
} satisfies PartnerFee;
```

## Global fee configuration

The recommended approach is to configure fees globally per feature when creating your SDK config using `new Sodax({...configuration})`.
This ensures all requests use the same fee configuration automatically:

```typescript
import { Sodax, PartnerFee } from '@sodax/sdk';

// both partnerFeePercentage or partnerFeeAmount can be used

// apply fee to swap feature
const sodaxWithSwapFees = new Sodax({
  swaps: { partnerFee: partnerFeePercentage },
});

// apply fee to money market feature
const sodaxWithMoneyMarketFees = new Sodax({
  moneyMarket: { partnerFee: partnerFeePercentage },
});

// apply fee to bridge feature
const sodaxWithBridgeFees = new Sodax({
  bridge: { partnerFee: partnerFeePercentage },
});

// apply fee to multiple features
const sodaxWithFees = new Sodax({
  swaps: { partnerFee: partnerFeePercentage },
  moneyMarket: { partnerFee: partnerFeePercentage },
  bridge: { partnerFee: partnerFeePercentage },
});
```

## Per-request fee configuration

There is no per-request fee override for `getQuote()` or `swap()`. Fees are always taken from the global config set on `new Sodax({ swaps: { partnerFee } })`. Configure different fee rates by creating separate `Sodax` instances.

### Quote request

`SwapService.getQuote()` automatically deducts the configured `swaps.partnerFee` from the `amount` before forwarding to the solver. No fee field appears in the request payload.

```typescript
import {
  type SolverIntentQuoteRequest,
} from "@sodax/sdk";

const result = await sodax.swaps.getQuote({
  token_src: '0x...', // The address of the source token on the spoke chain
  token_dst: '0x...', // The address of the destination token on the spoke chain
  token_src_blockchain_id: ChainKeys.BSC_MAINNET,  // Source chain key (e.g. Binance Smart Chain)
  token_dst_blockchain_id: ChainKeys.ARBITRUM_MAINNET, // Destination chain key (e.g. Arbitrum)
  amount: 1000000000000000n, // token amount in scaled token decimal precision (e.g. 1 ETH = 1e18)
  quote_type: 'exact_input', // type of quote
} satisfies SolverIntentQuoteRequest);

if (result.ok) {
  const { quoted_amount } = result.value;
  console.log('Quoted amount:', quoted_amount);
} else {
  // handle error
  console.error('Quote failed:', result.error);
}
```

### Swap request

The configured `swaps.partnerFee` is applied automatically by the service. No fee field appears in the call.

```typescript
const swapResult = await sodax.swaps.swap({
  params: {
    inputToken: '0x...',  // The address of the input token on the spoke chain
    outputToken: '0x...', // The address of the output token on the spoke chain
    inputAmount: 1_000_000n, // Amount of input tokens, fee will be deducted from this amount
    minOutputAmount: 900_000n, // Minimum output tokens expected
    deadline: 0n, // Optional: timestamp after which intent expires (0 = no deadline)
    allowPartialFill: false, // Whether intent can be partially filled
    srcChainKey: ChainKeys.BSC_MAINNET, // Source chain key
    dstChainKey: ChainKeys.ARBITRUM_MAINNET, // Destination chain key
    srcAddress: '0x...', // Originating address on source chain
    dstAddress: '0x...', // Destination address on destination chain
    solver: '0x0000000000000000000000000000000000000000', // Optional: specific solver, address(0) means any solver
    data: '0x', // Arbitrary additional data
  },
  walletProvider, // chain-narrowed wallet provider for the source chain
  timeout, // optional, request timeout in ms if needed
  skipSimulation, // optional - whether to skip transaction simulation (default: false)
});
```

## Partner Fee Claiming

Partners earn fees from every swap or bridge operation they facilitate. Those fees accrue as
wrapped ERC-20 tokens on the Sonic hub chain. The `sodax.partners` service exposes the full
lifecycle for retrieving and converting those balances.

### Accessing the partner service

```typescript
// Access via the Sodax facade — property is `partners` (not `partner`)
const { feeClaim } = sodax.partners;
```

### Step 1 — Query accrued balances

`fetchAssetsBalances` issues a multicall to the hub chain and returns only non-zero balances,
keyed by the wrapped asset address on Sonic.

```typescript
import { ChainKeys } from '@sodax/sdk';

const balancesResult = await sodax.partners.feeClaim.fetchAssetsBalances(
  '0xYourSonicAddress',
);

if (balancesResult.ok) {
  for (const [assetAddress, balance] of balancesResult.value) {
    console.log(`${balance.symbol}: ${balance.balance} (decimals: ${balance.decimal})`);
    console.log(`  Hub address:      ${balance.address}`);
    console.log(`  Original chain:   ${balance.originalChain}`);
    console.log(`  Original address: ${balance.originalAddress}`);
  }
} else {
  // error.message === 'FETCH_ASSETS_BALANCES_FAILED'
  console.error('Balance fetch failed:', balancesResult.error);
}
```

### Step 2 — Configure auto-swap preferences

Before claiming, configure where swapped proceeds should be delivered. Preferences are stored
on-chain and applied automatically to every future `createIntentAutoSwap` call.

```typescript
import { ChainKeys } from '@sodax/sdk';

// Read current preferences
const prefsResult = await sodax.partners.feeClaim.getAutoSwapPreferences('0xYourSonicAddress');
if (prefsResult.ok) {
  const { outputToken, dstChainKey, dstAddress } = prefsResult.value;
  // dstChainKey === 'not configured' when no destination chain has been set yet
  console.log('Current preferences:', { outputToken, dstChainKey, dstAddress });
}

// Write new preferences
const setResult = await sodax.partners.feeClaim.setSwapPreference({
  params: {
    srcChainKey: ChainKeys.SONIC_MAINNET, // must be the hub chain key
    srcAddress: '0xYourSonicAddress',
    outputToken: '0xDesiredOutputTokenAddress', // spoke-chain or hub-chain address
    dstChainKey: ChainKeys.ARBITRUM_MAINNET,   // chain to receive proceeds
    dstAddress: '0xYourArbitrumAddress',
  },
  walletProvider, // EVM wallet provider for Sonic
});

if (!setResult.ok) {
  console.error('Set preference failed:', setResult.error);
}
```

`setSwapPreference` supports both signed execution (`raw: false`) and raw transaction building
(`raw: true`). When `raw: true`, `walletProvider` must be omitted — the method returns the
unsigned transaction object instead.

### Step 3 — Approve the fee token

Before swapping, ensure the ProtocolIntents contract is approved to spend the fee token.
Native tokens are pre-approved and always return `true` from `isTokenApproved`.

```typescript
const approvedResult = await sodax.partners.feeClaim.isTokenApproved({
  srcChainKey: ChainKeys.SONIC_MAINNET,
  srcAddress: '0xYourSonicAddress',
  token: '0xFeeTokenHubAddress',
});

if (approvedResult.ok && !approvedResult.value) {
  // Not yet approved — send the approval transaction
  const approveResult = await sodax.partners.feeClaim.approveToken({
    params: {
      srcChainKey: ChainKeys.SONIC_MAINNET,
      srcAddress: '0xYourSonicAddress',
      token: '0xFeeTokenHubAddress',
    },
    walletProvider, // EVM wallet provider for Sonic
  });

  if (!approveResult.ok) {
    // error.message === 'APPROVE_TOKEN_FAILED'
    console.error('Approval failed:', approveResult.error);
  }
}
```

### Step 4 — Claim fees (end-to-end swap)

`swap` is the high-level method that submits the auto-swap intent on-chain and notifies the
solver to execute it in one call.

```typescript
const claimResult = await sodax.partners.feeClaim.swap({
  params: {
    srcChainKey: ChainKeys.SONIC_MAINNET, // must be the hub chain key
    srcAddress: '0xYourSonicAddress',
    fromToken: '0xFeeTokenHubAddress',
    amount: 1_000_000_000_000_000_000n, // amount in token's native decimals
    timeout: 30_000, // optional, ms to wait for tx confirmation
  },
  walletProvider, // EVM wallet provider for Sonic
});

if (claimResult.ok) {
  const { srcTxHash, intentTxHash, solverExecutionResponse } = claimResult.value;
  console.log('Intent submitted:', srcTxHash);
  console.log('Intent confirmed:', intentTxHash);
  console.log('Solver response:', solverExecutionResponse);
} else {
  // error.message may be:
  //   'WAIT_INTENT_AUTO_SWAP_FAILED' — receipt polling failed after submission
  //   error from createIntentAutoSwap — if the initial tx failed
  //   error from SolverApiService.postExecution — if solver notification failed
  console.error('Claim failed:', claimResult.error.message, claimResult.error.cause);
}
```

Use `createIntentAutoSwap` instead of `swap` when you need manual control over the solver
notification step (e.g. to retry independently).

### Error handling

All `partners.feeClaim` methods return `Promise<Result<T>>`. On failure, `result.ok` is `false`
and `result.error` is an `Error` object. Phase-failure errors follow the CODE form — check
`result.error.message` for the tag and `result.error.cause` for the underlying error:

```typescript
if (!result.ok) {
  const { message, cause } = result.error instanceof Error
    ? result.error
    : new Error(String(result.error));

  // CODE-form tags used by feeClaim methods:
  // 'FETCH_ASSETS_BALANCES_FAILED'
  // 'GET_AUTO_SWAP_PREFERENCES_FAILED'
  // 'APPROVE_TOKEN_FAILED'
  // 'IS_TOKEN_APPROVED_FAILED'
  // 'WAIT_INTENT_AUTO_SWAP_FAILED'
  console.error(`[${message}]`, cause);
}
```

The old typed partner error discriminators (five error types and their type-guard helpers) are
removed in v2. Branch on `result.error.message` instead.

### Raw transaction mode

Every write method on `PartnerFeeClaimService` supports `raw: true` to obtain the unsigned
transaction instead of broadcasting it. When `raw: true`, the `walletProvider` field must be
omitted — TypeScript enforces this at compile time.

```typescript
// Build the unsigned setSwapPreference transaction without broadcasting
const rawTxResult = await sodax.partners.feeClaim.setSwapPreference({
  params: {
    srcChainKey: ChainKeys.SONIC_MAINNET,
    srcAddress: '0xYourSonicAddress',
    outputToken: '0xOutputTokenAddress',
    dstChainKey: ChainKeys.ARBITRUM_MAINNET,
    dstAddress: '0xYourArbitrumAddress',
  },
  raw: true,
  // walletProvider must NOT be passed when raw: true
});

if (rawTxResult.ok) {
  const { from, to, data, value } = rawTxResult.value;
  // Sign and broadcast yourself
}
```
