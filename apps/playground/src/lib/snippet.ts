import type { ChainKey, PartnerFeePercentage, SpokeChainKey, XToken } from '@sodax/dapp-kit';
import { chainKeyExpression } from './chains';

export type SnippetState = {
  srcChain: ChainKey;
  dstChain: ChainKey;
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

/** The takeaway: the widget on the visitor's own page, opened on the pair they just configured. */
function embedSnippet(embedUrl: string): string {
  return `<!-- Quotes only. The widget mounts no wallet, so nobody can sign inside your page. -->
<iframe
  src="${embedUrl}"
  title="SODAX swap"
  width="480"
  height="620"
  loading="lazy"
  referrerpolicy="no-referrer"
  style="border: 0; border-radius: 24px; max-width: 100%"
></iframe>`;
}

function widgetSnippet(embedUrl: string): string {
  return `// The same embed as a component, for a React host. No SODAX package to install: the widget is
// a page, so it carries its own React, its own SDK version and its own token list.
type SodaxSwapWidgetProps = { src?: string; height?: number };

export function SodaxSwapWidget({ src = '${embedUrl}', height = 620 }: SodaxSwapWidgetProps) {
  return (
    <iframe
      src={src}
      title="SODAX swap"
      loading="lazy"
      referrerPolicy="no-referrer"
      style={{ width: '100%', maxWidth: 480, height, border: 0, borderRadius: 24 }}
    />
  );
}

// Every field of the form is a query parameter, so the host page decides what it opens on:
// ?srcChain= &srcToken= &dstChain= &dstToken= &amount= &slippage= &embed=1
// The partner fee is deliberately not one of them — it is the one field that redirects money.`;
}

function quoteSnippet(state: SnippetState): string {
  const { srcChain, dstChain, srcToken, dstToken, amount, slippagePercent, partnerFee } = state;
  const bps = Math.round((100 - Number(slippagePercent || '0')) * 100);

  const fee = partnerFee
    ? `
      // Applied once by the API before it quotes, so quotedAmount is already net of it. Never
      // subtract it yourself — that charges it twice. percentage is basis points: 100 = 1%.
      partnerFee: ${feeExpression(partnerFee)},`
    : `
      // Earning on the trade? Add partnerFee: { address, percentage } — SODAX takes no share of it.`;

  return `import { useSwapsApiQuote, ChainKeys } from '@sodax/dapp-kit';
import { parseUnits } from 'viem';

// ${srcToken?.symbol ?? 'TOKEN'} on ${chainKeyExpression(srcChain)} → ${dstToken?.symbol ?? 'TOKEN'} on ${chainKeyExpression(dstChain)}
// No wallet, no signer: a quote is an HTTP call, which is why this widget needs neither.
const { data: quote, isFetching } = useSwapsApiQuote({
  params: {
    body: {
      tokenSrc: '${srcToken?.address ?? '0x…'}',
      tokenSrcChainKey: ${chainKeyExpression(srcChain)},
      tokenDst: '${dstToken?.address ?? '0x…'}',
      tokenDstChainKey: ${chainKeyExpression(dstChain)},
      amount: parseUnits('${amount || '0'}', ${srcToken?.decimals ?? 18}).toString(),
      quoteType: 'exact_input',${fee}
    },
  },
  // A "no path" answer is a business result, not a transient failure — retrying only delays it.
  queryOptions: { retry: false, refetchInterval: 3000 },
});

// ${slippagePercent || '0'}% slippage, as integer basis points — never float math on token amounts.
const minOutputAmount = quote && (BigInt(quote.quotedAmount) * ${bps}n) / 10_000n;`;
}

function executeSnippet(state: SnippetState): string {
  const { srcChain, dstChain, srcToken, dstToken, partnerFee } = state;

  const fee = partnerFee
    ? `
  // The same fee the quote was taken with. Charging more leaves a minOutputAmount the intent
  // cannot deliver, and it never fills.
  partnerFee: ${feeExpression(partnerFee)},`
    : '';

  return `// Signing lives in your app, not in the widget. These are the four calls, in the order
// sodax.com/exchange/swap makes them — your wallet code sits between the third and the fourth.
import {
  useSwapsApiApproveAndBroadcast, useSwapsApiCreateIntent, useSwapsApiSubmitTx,
  useSwapsApiSubmitTxStatus, ChainKeys, type CreateIntentParamsV2,
} from '@sodax/dapp-kit';

const params: CreateIntentParamsV2 = {
  srcChainKey: ${chainKeyExpression(srcChain)},
  dstChainKey: ${chainKeyExpression(dstChain)},
  inputToken: '${srcToken?.address ?? '0x…'}',
  outputToken: '${dstToken?.address ?? '0x…'}',
  inputAmount: inputAmount.toString(),
  minOutputAmount: minOutputAmount.toString(),
  // Read from the chain, never from the client clock: sodax.api.swaps.getDeadline().
  deadline,
  allowPartialFill: false,
  srcAddress: account.address,
  dstAddress: account.address, // it does not have to be the sender — this is the payment case${fee}
};

// 1 · approve, when the source token needs it (skipped for a native asset)
await approveAndBroadcast({ params, walletProvider });
// 2 · build the unsigned intent tx
const { tx, intent, relayData } = await createIntent({ params });
// 3 · sign and broadcast \`tx\` with your own wallet, then
await submitTx({ request: { txHash, srcChainKey: ${chainKeyExpression(srcChain)}, walletAddress: account.address, intent, relayData } });
// 4 · poll until the solver reports SOLVED or FAILED
const { data: status } = useSwapsApiSubmitTxStatus({ params: { txHash } });`;
}

export function buildSnippets(state: SnippetState, embedUrl: string): Snippet[] {
  return [
    { id: 'embed', label: 'embed.html', code: embedSnippet(embedUrl) },
    { id: 'widget', label: 'Widget.tsx', code: widgetSnippet(embedUrl) },
    { id: 'quote', label: 'quote.tsx', code: quoteSnippet(state) },
    { id: 'execute', label: 'swap.tsx', code: executeSnippet(state) },
  ];
}

export type BridgeSnippetState = {
  srcChain: SpokeChainKey;
  dstChain: SpokeChainKey;
  srcToken: XToken | undefined;
  dstToken: XToken | undefined;
  amount: string;
};

function providersSnippet(chains: readonly SpokeChainKey[]): string {
  const entries = chains.map(key => `    [${chainKeyExpression(key)}]: { rpcUrl: '…' },`).join('\n');

  return `import { QueryClientProvider } from '@tanstack/react-query';
import { ChainKeys, SodaxProvider, createSodaxQueryClient, type SodaxOptions } from '@sodax/dapp-kit';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';

const queryClient = createSodaxQueryClient();

// SodaxProvider freezes its config by reference on first render — keep these module constants.
const chains = {
${entries}
};

const sodaxConfig: SodaxOptions = { chains };
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

function bridgeableSnippet(state: BridgeSnippetState): string {
  const { srcChain, dstChain, srcToken } = state;

  return `import { useGetBridgeableTokens, useGetBridgeableAmount, ChainKeys } from '@sodax/dapp-kit';

// "Bridgeable" means the same hub vault on both sides — the SDK derives the destination list, so
// there is nothing to hardcode and nothing to keep in sync when a token is added.
const { data: destinationTokens } = useGetBridgeableTokens({
  params: {
    from: ${chainKeyExpression(srcChain)},
    to: ${chainKeyExpression(dstChain)},
    token: '${srcToken?.address ?? '0x…'}',
  },
});

// Vault capacity, not a price: the most this pair can move right now.
const { data: limit } = useGetBridgeableAmount({ params: { from: srcToken, to: destinationTokens?.[0] } });`;
}

function bridgeSnippet(state: BridgeSnippetState): string {
  const { srcChain, dstChain, srcToken, dstToken, amount } = state;

  return `import {
  useBridge, useBridgeAllowance, useBridgeApprove, ChainKeys,
  type CreateBridgeIntentParams,
} from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { parseUnits } from 'viem';

const walletProvider = useWalletProvider({ xChainId: ${chainKeyExpression(srcChain)} });

// A bridge is 1:1, so there is no quote, no slippage and no deadline to read off the hub.
const params: CreateBridgeIntentParams = {
  srcAddress: account.address,
  srcChainKey: ${chainKeyExpression(srcChain)},
  srcToken: '${srcToken?.address ?? '0x…'}',
  amount: parseUnits('${amount || '0'}', ${srcToken?.decimals ?? 18}),
  dstChainKey: ${chainKeyExpression(dstChain)},
  dstToken: '${dstToken?.address ?? '0x…'}',
  recipient: account.address, // send it anywhere — it does not have to be the sender
};

const { data: hasAllowance } = useBridgeAllowance({ params: { payload: params, walletProvider } });
const { mutateAsyncSafe: approve } = useBridgeApprove();
const { mutateAsyncSafe: bridge } = useBridge();

if (!hasAllowance) await approve({ params, walletProvider });

const result = await bridge({ params, walletProvider });
if (!result.ok) return;

// srcChainTxHash is the spoke deposit; dstChainTxHash is the hub settlement that releases it.
const { srcChainTxHash, dstChainTxHash } = result.value;`;
}

export function buildBridgeSnippets(state: BridgeSnippetState, chains: readonly SpokeChainKey[]): Snippet[] {
  return [
    { id: 'providers', label: 'providers.tsx', code: providersSnippet(chains) },
    { id: 'tokens', label: 'tokens.tsx', code: bridgeableSnippet(state) },
    { id: 'execute', label: 'bridge.tsx', code: bridgeSnippet(state) },
  ];
}
