import { useMemo } from 'react';
import { BridgePanel } from '../components/BridgePanel';
import { CodePanel } from '../components/CodePanel';
import { Lockup } from '../components/Lockup';
import { useBridgeFlow } from '../hooks/useBridgeFlow';
import { bridgeTokenChoices, bridgeableChains } from '../lib/chains';
import { buildBridgeSnippets } from '../lib/snippet';

const BRIDGE_ASSET_COUNT = new Set(bridgeTokenChoices().map(({ token }) => token.symbol)).size;

/**
 * Parked. Fez's answer to "does this become a browser over the SDK's flows?" was "each thing
 * separate — a swaps widget now", so the rail is gone and nothing mounts this. It is kept whole,
 * and typechecked, because a bridge widget is the next one asked for; reviving it means a route of
 * its own plus remounting `SodaxWalletProvider`, which the swap widget deliberately does without.
 */
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
        <Lockup assetCount={BRIDGE_ASSET_COUNT} networkCount={bridgeableChains.length} />
        <BridgePanel flow={flow} />
      </div>
      <CodePanel snippets={snippets} initialId="tokens" />
    </>
  );
}
