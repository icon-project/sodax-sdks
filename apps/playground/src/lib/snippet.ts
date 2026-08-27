import type { PartnerFeePercentage, SpokeChainKey, XToken } from '@sodax/dapp-kit';
import { chainKeyExpression } from './chains';

export type SnippetState = {
  srcChain: SpokeChainKey;
  dstChain: SpokeChainKey;
  srcToken: XToken | undefined;
  dstToken: XToken | undefined;
  amount: string;
  slippagePercent: string;
  partnerFee: PartnerFeePercentage | undefined;
};

export type Snippet = { id: string; label: string; code: string };

function feeExpression(fee: PartnerFeePercentage): string {
  return `{ address: '${fee.address}', percentage: ${fee.percentage} }`;
}

function providersSnippet(chains: readonly SpokeChainKey[], partnerFee: PartnerFeePercentage | undefined): string {
  const entries = chains.map(key => `    [${chainKeyExpression(key)}]: { rpcUrl: '…' },`).join('\n');

  const fee = partnerFee
    ? `

// Configured once, so every swap charges it and useQuote deducts it before quoting — quoted_amount
// is already net. percentage is basis points: 100 = 1%. SODAX takes none of this.
const swaps = { partnerFee: ${feeExpression(partnerFee)} };`
    : '';

  return `import { QueryClientProvider } from '@tanstack/react-query';
import { ChainKeys, SodaxProvider, createSodaxQueryClient, type SodaxOptions } from '@sodax/dapp-kit';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';

const queryClient = createSodaxQueryClient();

// SodaxProvider freezes its config by reference on first render — keep these module constants.
const chains = {
${entries}
};${fee}

const sodaxConfig: SodaxOptions = { chains${partnerFee ? ', swaps' : ''} };
const walletConfig: SodaxWalletConfig = { EVM: { ssr: true, chains } };

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SodaxProvider config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>
        <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}`;
}

function quoteSnippet(state: SnippetState): string {
  const { srcChain, dstChain, srcToken, dstToken, amount, partnerFee } = state;

  const fee = partnerFee
    ? '\n// The configured partner fee comes off the input first, so quoted_amount is already net of it.'
    : '';

  return `import { useQuote, ChainKeys } from '@sodax/dapp-kit';
import { parseUnits } from 'viem';

// ${srcToken?.symbol ?? 'TOKEN'} on ${chainKeyExpression(srcChain)} → ${dstToken?.symbol ?? 'TOKEN'} on ${chainKeyExpression(dstChain)}${fee}
const { data: quoteResult, isFetching } = useQuote({
  params: {
    payload: {
      token_src: '${srcToken?.address ?? '0x…'}',
      token_src_blockchain_id: ${chainKeyExpression(srcChain)},
      token_dst: '${dstToken?.address ?? '0x…'}',
      token_dst_blockchain_id: ${chainKeyExpression(dstChain)},
      amount: parseUnits('${amount || '0'}', ${srcToken?.decimals ?? 18}),
      quote_type: 'exact_input',
    },
  },
});

// Query hooks surface the SDK's Result directly — always check .ok before reading .value.
const quotedAmount = quoteResult?.ok ? quoteResult.value.quoted_amount : undefined;`;
}

function executeSnippet(state: SnippetState): string {
  const { srcChain, dstChain, srcToken, dstToken, amount, slippagePercent, partnerFee } = state;
  const bps = Math.round((100 - Number(slippagePercent || '0')) * 100);

  const swapCall = partnerFee
    ? `// Per-action override of the configured fee. It must match the fee the quote was taken with —
// a swap charging more leaves a minOutputAmount the intent cannot deliver, and it never fills.
const result = await swap({ params, walletProvider, extras: { partnerFee: ${feeExpression(partnerFee)} } });`
    : `// Charging a fee? Add it here — SODAX takes none of it.
// const result = await swap({ params, walletProvider, extras: { partnerFee: { address, percentage } } });
const result = await swap({ params, walletProvider });`;

  return `import {
  useSodaxContext, useSwap, useSwapAllowance, useSwapApprove, useStatus, ChainKeys,
  type CreateIntentParams,
} from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { parseUnits } from 'viem';

const { sodax } = useSodaxContext();
const walletProvider = useWalletProvider({ xChainId: ${chainKeyExpression(srcChain)} });

const inputAmount = parseUnits('${amount || '0'}', ${srcToken?.decimals ?? 18});
// ${slippagePercent}% slippage, as integer basis points — never float math on token amounts.
const minOutputAmount = (BigInt(quotedAmount) * ${bps}n) / 10_000n;

// The deadline is a hub-chain timestamp. Read it at submit time, not from the client clock.
const deadline = await sodax.swaps.getSwapDeadline();
if (!deadline.ok) return;

const params: CreateIntentParams = {
  inputToken: '${srcToken?.address ?? '0x…'}',
  outputToken: '${dstToken?.address ?? '0x…'}',
  inputAmount,
  minOutputAmount,
  deadline: deadline.value,
  allowPartialFill: false,
  srcChainKey: ${chainKeyExpression(srcChain)},
  dstChainKey: ${chainKeyExpression(dstChain)},
  srcAddress: account.address,
  dstAddress: account.address,
  solver: '0x0000000000000000000000000000000000000000', // any admitted solver may fill
  data: '0x',
};

// On mainnet ERC-20s you must approve before the first swap.
const { data: hasAllowance } = useSwapAllowance({
  params: { payload: params, srcChainKey: ${chainKeyExpression(srcChain)}, walletProvider },
});
const { mutateAsyncSafe: approve } = useSwapApprove();
const { mutateAsyncSafe: swap } = useSwap();

if (!hasAllowance) await approve({ params, walletProvider });

${swapCall}
if (!result.ok) return;

// Poll until the solver reports SOLVED (3) or FAILED (4).
const { data: status } = useStatus({
  params: { intentTxHash: result.value.intentDeliveryInfo.dstTxHash },
});`;
}

export function buildSnippets(state: SnippetState, chains: readonly SpokeChainKey[]): Snippet[] {
  return [
    { id: 'providers', label: 'providers.tsx', code: providersSnippet(chains, state.partnerFee) },
    { id: 'quote', label: 'quote.tsx', code: quoteSnippet(state) },
    { id: 'execute', label: 'swap.tsx', code: executeSnippet(state) },
  ];
}
