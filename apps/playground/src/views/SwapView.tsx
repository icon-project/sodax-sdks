import { useMemo } from 'react';
import { CodePanel } from '../components/CodePanel';
import { Lockup } from '../components/Lockup';
import { SwapPanel } from '../components/SwapPanel';
import { embedOrigin } from '../config';
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

export function SwapView({ flow }: { flow: SwapFlow }) {
  const { srcChain, dstChain, srcToken, dstToken, amount, slippagePercent, partnerFee } = flow;

  const snippets = useMemo(() => {
    if (!srcChain || !dstChain) return undefined;

    const state = { srcChain, dstChain, srcToken, dstToken, amount, slippagePercent, partnerFee };
    const url = embedUrl(embedOrigin, { ...state, flow: 'swap', slippage: slippagePercent });

    return buildSnippets(state, url);
  }, [srcChain, dstChain, srcToken, dstToken, amount, slippagePercent, partnerFee]);

  return (
    <>
      <SwapWidget flow={flow} />
      {snippets && <CodePanel snippets={snippets} initialId="embed" />}
    </>
  );
}
