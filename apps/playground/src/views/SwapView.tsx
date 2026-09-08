import { useMemo } from 'react';
import { BrandBar } from '../components/BrandBar';
import { CodePanel } from '../components/CodePanel';
import { Lockup } from '../components/Lockup';
import { SwapPanel } from '../components/SwapPanel';
import { embedOrigin } from '../config';
import type { BrandControls } from '../hooks/useBrand';
import type { SwapFlow } from '../hooks/useSwapFlow';
import { buildSnippets } from '../lib/snippet';
import { embedUrl } from '../lib/urlState';

/** The widget alone. This is what an `<iframe>` frames, and what the demo page wraps. */
export function SwapWidget({ flow }: { flow: SwapFlow }) {
  return (
    <div className="flow-column">
      <Lockup assetCount={flow.assetCount} networkCount={flow.networkCount} />
      <SwapPanel flow={flow} />
    </div>
  );
}

export function SwapView({ flow, brandControls }: { flow: SwapFlow; brandControls: BrandControls }) {
  const { srcChain, dstChain, srcToken, dstToken, amount, slippagePercent, partnerFee, brand } = flow;

  const snippets = useMemo(() => {
    if (!srcChain || !dstChain) return undefined;

    const state = { srcChain, dstChain, srcToken, dstToken, amount, slippagePercent, partnerFee };
    const url = embedUrl(embedOrigin, { ...state, flow: 'swap', slippage: slippagePercent, brand });

    return buildSnippets(state, url);
  }, [srcChain, dstChain, srcToken, dstToken, amount, slippagePercent, partnerFee, brand]);

  // The controls and the snippet they produce share a column, so styling the widget and copying the
  // result is one eyeline. Both are demo chrome; the framed widget is `SwapWidget` above.
  return (
    <>
      <SwapWidget flow={flow} />
      <div className="build-column">
        <BrandBar controls={brandControls} />
        {snippets && <CodePanel snippets={snippets} initialId="embed" />}
      </div>
    </>
  );
}
