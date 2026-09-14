import { useMemo, useState } from 'react';
import { BrandBar } from '../components/BrandBar';
import { CodePanel } from '../components/CodePanel';
import { Lockup } from '../components/Lockup';
import { SwapPanel } from '../components/SwapPanel';
import { SwapActivity } from '../components/SwapActivity';
import { embedOrigin } from '../config';
import type { BrandControls } from '../hooks/useBrand';
import type { SwapFlow } from '../hooks/useSwapFlow';
import { buildSnippets } from '../lib/snippet';
import { embedUrl } from '../lib/urlState';
import { chainName } from '../lib/chains';
import { networkAllowed } from '../lib/widgetSettings';
import { canExecute } from '../lib/execution';
import { trackSnippetCopied } from '../lib/analytics';

/** The widget alone. This is what an `<iframe>` frames, and what the demo page wraps. */
export function SwapWidget({ flow }: { flow: SwapFlow }) {
  return (
    <div className="flow-column">
      <Lockup assetCount={flow.assetCount} networkCount={flow.networkCount} />
      <SwapPanel flow={flow} />
      <SwapActivity execution={flow.execution} />
    </div>
  );
}

export function SwapView({ flow, brandControls }: { flow: SwapFlow; brandControls: BrandControls }) {
  const [panel, setPanel] = useState<'style' | 'behavior'>('style');
  const [mobile, setMobile] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const { srcChain, dstChain, srcToken, dstToken, amount, slippagePercent, partnerFee, brand, widget } = flow;

  const snippets = useMemo(() => {
    if (!srcChain || !dstChain || !flow.isAmountValid || !flow.isSlippageValid) return undefined;

    const state = { srcChain, dstChain, srcToken, dstToken, amount, slippagePercent, partnerFee };
    const url = embedUrl(embedOrigin, { ...state, flow: 'swap', slippage: slippagePercent, brand, widget });

    return buildSnippets(state, url);
  }, [
    srcChain,
    dstChain,
    srcToken,
    dstToken,
    amount,
    slippagePercent,
    partnerFee,
    brand,
    widget,
    flow.isAmountValid,
    flow.isSlippageValid,
  ]);

  const copyEmbed = async () => {
    const snippet = snippets?.find(item => item.id === 'embed');
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet.code);
      trackSnippetCopied('embed');
      setCopyMessage('Embed copied');
    } catch {
      setCopyMessage('Select and copy the code below.');
      setCodeOpen(true);
    }
  };

  return (
    <>
      <div className="studio-heading">
        <p className="eyebrow">SODAX WIDGET</p>
        <h2>
          Your app. <em>Connected.</em>
        </h2>
        <p className="muted">Try a swap, make it yours, and take it with you.</p>
      </div>
      <div className="preview-column">
        <div className="preview-toolbar">
          <span className="eyebrow">Live preview</span>
          <fieldset className="segmented" aria-label="Preview width">
            <button type="button" className="btn" aria-pressed={!mobile} onClick={() => setMobile(false)}>
              Desktop
            </button>
            <button type="button" className="btn" aria-pressed={mobile} onClick={() => setMobile(true)}>
              Mobile
            </button>
          </fieldset>
        </div>
        <div className={`widget-preview${mobile ? ' preview-mobile' : ''}`}>
          <SwapWidget flow={flow} />
        </div>
      </div>
      <div className="build-column">
        <fieldset className="segmented builder-tabs" aria-label="Widget configuration">
          <button type="button" className="btn" aria-pressed={panel === 'style'} onClick={() => setPanel('style')}>
            Style
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={panel === 'behavior'}
            onClick={() => setPanel('behavior')}
          >
            Behavior
          </button>
        </fieldset>
        {panel === 'style' ? (
          <BrandBar controls={brandControls} />
        ) : (
          <section className="card behavior-card">
            <h3>Networks &amp; defaults</h3>
            <p className="muted small">
              Choose which networks your users can select. Set the starting assets and amount in the preview.
            </p>
            {(['sourceNetworks', 'destinationNetworks'] as const).map(key => (
              <fieldset className="network-settings" key={key}>
                <legend>{key === 'sourceNetworks' ? 'Send from' : 'Receive on'}</legend>
                <button
                  type="button"
                  className="btn"
                  onClick={() => flow.setWidget(current => ({ ...current, [key]: [] }))}
                >
                  All networks
                </button>
                <div className="network-checks">
                  {flow.chains.map(chain => (
                    <label key={chain}>
                      <input
                        type="checkbox"
                        checked={networkAllowed(chain, widget[key])}
                        onChange={event => {
                          const checked = event.target.checked;
                          flow.setWidget(current => {
                            const active = current[key].length ? current[key] : flow.chains;
                            const next = checked ? [...active, chain] : active.filter(value => value !== chain);
                            return next.length ? { ...current, [key]: [...new Set(next)] } : current;
                          });
                        }}
                      />
                      <span>{chainName(chain)}</span>
                      {!canExecute(chain) && <span className="muted small">Quote only</span>}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <p className="muted small">
              In-widget execution: EVM, Solana and Sui. Other networks open the SODAX exchange.
            </p>
          </section>
        )}
        <section className="card integration-card">
          <p className="eyebrow">READY TO EMBED</p>
          <h3>Bring swaps to your app</h3>
          <p className="muted small">
            Copy the widget with your style, networks and default trade. No package installation needed.
          </p>
          <div className="integration-actions">
            <button type="button" className="btn btn-primary" disabled={!snippets} onClick={copyEmbed}>
              Copy embed
            </button>
            <button type="button" className="btn" aria-expanded={codeOpen} onClick={() => setCodeOpen(!codeOpen)}>
              {codeOpen ? 'Hide code' : 'View code'}
            </button>
          </div>
          <p className="small" role="status">
            {copyMessage}
          </p>
          <details className="disclosure">
            <summary>Partner fees &amp; wallet setup</summary>
            <p className="muted small">
              {partnerFee
                ? `This deployment charges a ${partnerFee.percentage / 100}% partner fee, included in every quote.`
                : 'This deployment has no partner fee.'}{' '}
              Partner fees are configured by the widget operator, not by visitors.
            </p>
            <p className="muted small">
              The hosted widget uses its own wallet connection. WalletConnect requires a project ID on the deployment.
              Injected wallet availability inside an iframe varies by wallet.
            </p>
          </details>
        </section>
      </div>
      {codeOpen && snippets && (
        <div className="studio-code">
          <CodePanel snippets={snippets} initialId="embed" />
        </div>
      )}
    </>
  );
}
