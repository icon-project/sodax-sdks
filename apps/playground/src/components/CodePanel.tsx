import { useMemo, useState } from 'react';
import type { SwapFlow } from '../hooks/useSwapFlow';
import { swappableChains } from '../lib/chains';
import { buildSnippets } from '../lib/snippet';

export function CodePanel({ flow }: { flow: SwapFlow }) {
  const [activeId, setActiveId] = useState('quote');
  const [copied, setCopied] = useState(false);

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

  const active = snippets.find(snippet => snippet.id === activeId) ?? snippets[0];

  const copy = async () => {
    await navigator.clipboard.writeText(active.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="card code-card">
      <header className="code-header">
        <div className="tabs">
          {snippets.map(snippet => (
            <button
              type="button"
              key={snippet.id}
              className={snippet.id === activeId ? 'tab tab-active' : 'tab'}
              onClick={() => setActiveId(snippet.id)}
            >
              {snippet.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </header>
      <pre className="code">
        <code>{active.code}</code>
      </pre>
      <p className="code-note muted small">
        This updates with the form. Chain and token values come from <code>@sodax/types</code>, so the snippet always
        names symbols that exist in the version you install.
      </p>
    </section>
  );
}
