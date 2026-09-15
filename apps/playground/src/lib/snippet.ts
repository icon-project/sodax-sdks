import type { ChainKey, PartnerFeePercentage, XToken } from '@sodax/dapp-kit';
import { DENSITIES, FONT_STACKS, RADIUS_SCALES } from './brand';
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
  return `<!-- Live mainnet swaps. Visitors connect and approve transactions in their wallet. -->
<iframe
  src="${embedUrl}"
  title="SODAX swap"
  width="480"
  height="760"
  loading="lazy"
  referrerpolicy="no-referrer"
  style="border: 0; border-radius: 24px; max-width: 100%"
></iframe>
<script>
  (() => {
    const frame = document.currentScript.previousElementSibling;
    const origin = new URL(frame.src).origin;
    window.addEventListener('message', event => {
      if (event.source !== frame.contentWindow || event.origin !== origin) return;
      if (event.data?.type === 'sodax:resize' && Number.isFinite(event.data.height)) {
        frame.height = String(Math.max(360, Math.min(1600, event.data.height)));
      }
    });
  })();
</script>`;
}

function widgetSnippet(embedUrl: string): string {
  return `// The same embed as a component, for a React host. No SODAX package to install: the widget is
// a page, so it carries its own React, its own SDK version and its own token list.
import { useEffect, useRef } from 'react';

type SodaxSwapWidgetProps = { src?: string; height?: number };

export function SodaxSwapWidget({ src = '${embedUrl}', height = 760 }: SodaxSwapWidgetProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const element = frame.current;
      if (!element || event.source !== element.contentWindow || event.origin !== new URL(src).origin) return;
      if (event.data?.type === 'sodax:resize' && Number.isFinite(event.data.height)) {
        element.style.height = String(Math.max(360, Math.min(1600, event.data.height))) + 'px';
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [src]);
  return (
    <iframe
      ref={frame}
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
// The partner fee is deliberately not one of them — it is the one field that redirects money.
${themeParamsComment()}`;
}

/**
 * The theme API, listed off the constants that define it so the snippet cannot drift from what the
 * widget actually accepts.
 */
function themeParamsComment(): string {
  const options = (choices: object) => Object.keys(choices).join('|');

  return `// Styling is query parameters too — the src above already carries whatever you set here:
// ?theme=light|dark|auto
// &accent=  &cta=  &surface=  &text=      6-digit hex, no "#" (e.g. accent=7c3aed)
// &radius=${options(RADIUS_SCALES)}
// &font=${options(FONT_STACKS)}
// &density=${options(DENSITIES)}
// Set accent and surface and the rest is derived: the button label, every border and the text ramp
// are computed from them, so a brand colour cannot produce a control nobody can read.`;
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
// Quotes are available before a wallet is connected.
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
  queryOptions: { retry: false, refetchInterval: 10000 },
});

// ${slippagePercent || '0'}% slippage, as integer basis points — never float math on token amounts.
const minOutputAmount = quote && (BigInt(quote.quotedAmount) * ${bps}n) / 10_000n;`;
}

/**
 * The hosted embed owns execution; the quote tab is an optional lower-level integration example.
 */
export function buildSnippets(state: SnippetState, embedUrl: string): Snippet[] {
  return [
    { id: 'embed', label: 'embed.html', code: embedSnippet(embedUrl) },
    { id: 'widget', label: 'Widget.tsx', code: widgetSnippet(embedUrl) },
    { id: 'quote', label: 'quote.tsx', code: quoteSnippet(state) },
  ];
}
