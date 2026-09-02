import { useMemo } from 'react';
import { BridgePanel } from '../components/BridgePanel';
import { CodePanel } from '../components/CodePanel';
import { Lockup } from '../components/Lockup';
import { useBridgeFlow } from '../hooks/useBridgeFlow';
import { bridgeableChains } from '../lib/chains';
import { buildBridgeSnippets } from '../lib/snippet';

export function BridgeView() {
  const flow = useBridgeFlow();

  const snippets = useMemo(
    () =>
      buildBridgeSnippets(
        {
          srcChain: flow.srcChain,
          dstChain: flow.dstChain,
          srcToken: flow.srcToken,
          dstToken: flow.dstToken,
          amount: flow.amount,
        },
        bridgeableChains,
      ),
    [flow.srcChain, flow.dstChain, flow.srcToken, flow.dstToken, flow.amount],
  );

  return (
    <>
      <div className="flow-column">
        <Lockup flow="bridge" />
        <BridgePanel flow={flow} />
      </div>
      <CodePanel snippets={snippets} initialId="tokens" />
    </>
  );
}
