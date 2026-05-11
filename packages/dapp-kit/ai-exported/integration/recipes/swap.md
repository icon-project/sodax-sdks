# Recipe: Swap

Cross-chain token swaps via the intent-based solver.

**Depends on:** [setup.md](setup.md), [wallet-connectivity.md](wallet-connectivity.md)

## Hooks

| Hook | Type | Purpose |
|------|------|---------|
| `useQuote` | Query | Real-time swap quote (auto-refreshes 3s) |
| `useSwap` | Mutation | Execute a complete cross-chain swap |
| `useSwapAllowance` | Query | Check if token approval is needed |
| `useSwapApprove` | Mutation | Approve tokens for the swap contract |
| `useStatus` | Query | Track intent execution status |
| `useCancelSwap` | Mutation | Cancel an active swap intent |
| `useCreateLimitOrder` | Mutation | Create a limit order (no deadline) |
| `useCancelLimitOrder` | Mutation | Cancel an active limit order |

## Get a Quote

```tsx
import { useQuote } from '@sodax/dapp-kit';
import { ChainKeys } from '@sodax/sdk';

function SwapQuote({ inputAmount }: { inputAmount: bigint }) {
  const { data: quoteResult, isLoading } = useQuote({
    params: {
      payload: inputAmount > 0n
        ? {
            token_src: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
            token_dst: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
            token_src_blockchain_id: ChainKeys.BSC_MAINNET,
            token_dst_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
            amount: inputAmount,
            quote_type: 'exact_input',
          }
        : undefined,
    },
  });

  if (isLoading) return <div>Fetching quote...</div>;
  if (quoteResult?.ok) return <div>Output: {quoteResult.value.quoted_amount}</div>;
  return null;
}
```

## Check Allowance + Approve

```tsx
import { useSwapAllowance, useSwapApprove } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import type { CreateIntentParams } from '@sodax/sdk';

function SwapApproval({ intentParams }: { intentParams: CreateIntentParams }) {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });

  // useSwapAllowance wraps the request under params.payload and takes walletProvider + srcChainKey
  // alongside (all under `params`, not at the top level).
  const { data: isApproved } = useSwapAllowance({
    params: {
      payload: intentParams,
      srcChainKey: ChainKeys.BSC_MAINNET,
      walletProvider,
    },
  });
  const { mutateAsync: approve, isPending } = useSwapApprove();

  // useSwapAllowance data is `boolean | undefined` (already unwrapped from Result by the hook).
  if (isApproved) return null;
  return (
    <button onClick={() => walletProvider && approve({ params: intentParams, walletProvider })} disabled={isPending}>
      {isPending ? 'Approving...' : 'Approve Token'}
    </button>
  );
}
```

## Execute Swap

```tsx
import { useSwap } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import type { CreateIntentParams } from '@sodax/sdk';

function SwapButton({ intentParams }: { intentParams: CreateIntentParams }) {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
  const { mutateAsync: swap, isPending } = useSwap();

  const handleSwap = async () => {
    if (!walletProvider) return;
    try {
      const { solverExecutionResponse, intent, intentDeliveryInfo } = await swap({
        params: intentParams,
        walletProvider,
      });
      console.log('Swap successful!', solverExecutionResponse);
    } catch (e) {
      // surfaced via mutation.error / onError
    }
  };

  return (
    <button onClick={handleSwap} disabled={isPending || !walletProvider}>
      {isPending ? 'Swapping...' : 'Swap'}
    </button>
  );
}
```

## Full Example

```tsx
import { useState } from 'react';
import { useQuote, useSwap, useSwapAllowance, useSwapApprove } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import type { CreateIntentParams, SolverIntentQuoteRequest } from '@sodax/sdk';
import { parseUnits } from 'viem';

const SRC_TOKEN = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8';
const DST_TOKEN = '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f';

export function SwapPage() {
  const [inputAmount, setInputAmount] = useState('');
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET });
  const parsedAmount = inputAmount ? parseUnits(inputAmount, 18) : 0n;

  // 1. Quote — useQuote takes { params: { payload: SolverIntentQuoteRequest } }.
  const { data: quoteResult, isLoading: isQuoting } = useQuote({
    params: {
      payload: parsedAmount > 0n
        ? {
            token_src: SRC_TOKEN,
            token_dst: DST_TOKEN,
            token_src_blockchain_id: ChainKeys.BSC_MAINNET,
            token_dst_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
            amount: parsedAmount,
            quote_type: 'exact_input',
          }
        : undefined,
    },
  });

  // 2. Build intent params. The request-side fields are `srcChainKey` / `dstChainKey`
  // (distinct from the read-side `Intent.srcChain` / `Intent.dstChain` which are
  // `IntentRelayChainId` bigints — a separate shape).
  const intentParams: CreateIntentParams | undefined =
    quoteResult?.ok
      ? {
          inputToken: SRC_TOKEN,
          outputToken: DST_TOKEN,
          inputAmount: parsedAmount,
          minOutputAmount: BigInt(quoteResult.value.quoted_amount),
          deadline: 0n,
          allowPartialFill: false,
          srcChainKey: ChainKeys.BSC_MAINNET,
          dstChainKey: ChainKeys.ARBITRUM_MAINNET,
          srcAddress: '0x0000000000000000000000000000000000000000', // connected wallet address
          dstAddress: '0x0000000000000000000000000000000000000000', // destination address
          solver: '0x0000000000000000000000000000000000000000',
          data: '0x',
        }
      : undefined;

  // 3. Allowance — useSwapAllowance nests payload + srcChainKey + walletProvider under params.
  const { data: isApproved } = useSwapAllowance({
    params: intentParams
      ? { payload: intentParams, srcChainKey: ChainKeys.BSC_MAINNET, walletProvider }
      : undefined,
  });

  // 4. Approve + Swap (using mutateAsyncSafe — no try/catch, no unhandled rejections)
  const { mutateAsyncSafe: approve, isPending: isApproving } = useSwapApprove();
  const { mutateAsyncSafe: swap, isPending: isSwapping } = useSwap();

  const handleSwap = async () => {
    if (!intentParams || !walletProvider) return;
    if (!isApproved) {
      const r = await approve({ params: intentParams, walletProvider });
      if (!r.ok) { alert(r.error instanceof Error ? r.error.message : 'Approve failed'); return; }
    }
    const r = await swap({ params: intentParams, walletProvider });
    if (r.ok) alert('Swap successful!');
    else alert(r.error instanceof Error ? r.error.message : 'Swap failed');
  };

  return (
    <div>
      <input placeholder="Amount" value={inputAmount} onChange={(e) => setInputAmount(e.target.value)} />
      {isQuoting && <p>Fetching quote...</p>}
      {quoteResult?.ok && <p>Output: {quoteResult.value.quoted_amount}</p>}
      <button onClick={handleSwap} disabled={isSwapping || isApproving || !intentParams}>
        {isApproving ? 'Approving...' : isSwapping ? 'Swapping...' : 'Swap'}
      </button>
    </div>
  );
}
```

## Limit Orders

```tsx
import { useCreateLimitOrder, useCancelLimitOrder } from '@sodax/dapp-kit';
import type { Intent } from '@sodax/sdk';

const { mutateAsync: createLimitOrder } = useCreateLimitOrder();
const { mutateAsync: cancelLimitOrder } = useCancelLimitOrder();

// Limit orders have no deadline, must be cancelled manually.
// `useCancelLimitOrder` TVars are FLAT: `{ srcChainKey, intent, walletProvider }` (no `params` wrapper).
async function flow(intent: Intent) {
  if (!walletProvider) return;
  await createLimitOrder({ params: limitOrderParams, walletProvider });
  await cancelLimitOrder({ srcChainKey, intent, walletProvider });
}
```

## Customize TanStack Query behavior

Every mutation hook accepts an optional `mutationOptions` slot for consumers to override TanStack Query knobs (`retry`, `onError`, `mutationKey`, etc.). The hook's `mutationFn` throws on SDK failure (so `mutation.error`, `onError`, and `retry` engage natively); its own `onSuccess` invalidations run first on real success, then the consumer's `onSuccess` is awaited.

```tsx
import { useSwap } from '@sodax/dapp-kit';
import { useIsMutating } from '@tanstack/react-query';

const { mutateAsync: swap, isError, error } = useSwap({
  mutationOptions: {
    retry: 5,
    onError: err => toast.error(err.message),
    onSuccess: swapResponse => {
      // Runs AFTER dapp-kit's xBalances invalidations — only on confirmed success.
      trackSwap(swapResponse);
    },
  },
});

// Track in-flight swaps anywhere in the app via the default mutationKey
const swapsInFlight = useIsMutating({ mutationKey: ['swap'] });
console.log({ swap, isError, error, swapsInFlight });
```

## Gotchas

### Token list has duplicate addresses

`getSupportedSolverTokens()` can return multiple tokens sharing the same contract address (same token on different chains). When rendering token lists, use a composite key like `${token.address}-${token.blockchain_id}` — not `token.address` alone.

### Balance display

Balances come from `@sodax/wallet-sdk-react`, not from dapp-kit. See `wallet-connectivity.md` for `useXBalances`.

## Types

```typescript
type CreateIntentParams = {
  inputToken: string;
  outputToken: string;
  inputAmount: bigint;
  minOutputAmount: bigint;
  deadline: bigint;            // 0n = no deadline
  allowPartialFill: boolean;
  srcChain: SpokeChainId;
  dstChain: SpokeChainId;
  srcAddress: string;
  dstAddress: string;
  solver: Address;             // address(0) = any solver
  data: Hex;
};
```
