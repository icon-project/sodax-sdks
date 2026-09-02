import { useMemo } from 'react';
import { CodePanel } from '../components/CodePanel';
import { Lockup } from '../components/Lockup';
import { SwapPanel } from '../components/SwapPanel';
import { useSwapFlow } from '../hooks/useSwapFlow';
import { swappableChains } from '../lib/chains';
import { buildSnippets } from '../lib/snippet';

export function SwapView() {
  const flow = useSwapFlow();

  const snippets = useMemo(
    () =>
      buildSnippets(
        {
          srcChain: flow.srcChain,
          dstChain: flow.dstChain,
          srcToken: flow.srcToken,
          dstToken: flow.dstToken,
          amount: flow.amount,
          slippagePercent: flow.slippagePercent,
          partnerFee: flow.partnerFee,
        },
        swappableChains,
      ),
    [flow.srcChain, flow.dstChain, flow.srcToken, flow.dstToken, flow.amount, flow.slippagePercent, flow.partnerFee],
  );

  return (
    <>
      <div className="flow-column">
        <Lockup flow="swap" />
        <SwapPanel flow={flow} />
      </div>
      <CodePanel snippets={snippets} initialId="quote" />
    </>
  );
}
