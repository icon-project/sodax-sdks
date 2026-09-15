import { useMemo, useState } from 'react';
import { BrandBar } from '../components/BrandBar';
import { CodePanel } from '../components/CodePanel';
import { SetupPanel } from '../components/SetupPanel';
import { WidgetPreview } from '../components/WidgetPreview';
import { SwapPanel } from '../components/SwapPanel';
import { SwapActivity } from '../components/SwapActivity';
import { embedOrigin } from '../config';
import type { BrandControls } from '../hooks/useBrand';
import type { SwapFlow } from '../hooks/useSwapFlow';
import { buildSnippets } from '../lib/snippet';
import { embedUrl, toSearch } from '../lib/urlState';
import { trackSnippetCopied } from '../lib/analytics';

export function SwapWidget({ flow }: { flow: SwapFlow }) {
  return (
    <div className="flow-column">
      <header className="widget-heading">
        <h2>Swap</h2>
      </header>
      <SwapPanel flow={flow} />
      <SwapActivity execution={flow.execution} />
    </div>
  );
}

const PANELS = { setup: 'Setup', appearance: 'Appearance', integrate: 'Integrate' } as const;

export function SwapView({ flow, brandControls }: { flow: SwapFlow; brandControls: BrandControls }) {
  const [panel, setPanel] = useState<keyof typeof PANELS>('setup');
  const [mobile, setMobile] = useState(false);
  // Success is confirmed on the button that was pressed; the line below is for the paths that need
  // an instruction, so nothing reserves space for a message that is usually absent.
  const [copied, setCopied] = useState<'share' | 'embed'>();
  const [notice, setNotice] = useState('');
  const [shareFallback, setShareFallback] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const { srcChain, dstChain, srcToken, dstToken, amount, slippagePercent, partnerFee, brand, widget } = flow;
  const configured = useMemo(() => {
    if (!srcChain || !dstChain || !srcToken || !dstToken || !flow.isAmountValid || !flow.isSlippageValid)
      return undefined;
    const state = { srcChain, dstChain, srcToken, dstToken, amount, slippagePercent, partnerFee };
    const settings = { ...state, slippage: slippagePercent, widget };
    const url = embedUrl(embedOrigin, { ...settings, brand });
    return {
      snippets: buildSnippets(state, url),
      preview: embedUrl(window.location.origin, settings),
      share: `${window.location.origin}${window.location.pathname}?${toSearch({ ...settings, brand })}`,
    };
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

  const confirm = (button: 'share' | 'embed') => {
    setCopied(button);
    window.setTimeout(() => setCopied(undefined), 1500);
  };

  const share = async () => {
    if (!configured) return;
    try {
      await navigator.clipboard.writeText(configured.share);
      setShareFallback('');
      setNotice('');
      confirm('share');
    } catch {
      setShareFallback(configured.share);
      setNotice('Select and copy your configuration link below.');
    }
  };
  const copy = async () => {
    const snippet = configured?.snippets.find(item => item.id === 'embed');
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet.code);
      trackSnippetCopied('embed');
      setNotice('');
      confirm('embed');
    } catch {
      setPanel('integrate');
      setNotice('Select and copy the code in Integrate.');
    }
  };

  return (
    <>
      <div className="studio-heading">
        <div>
          <h2>Build your swap widget.</h2>
          <p className="muted">Set the trade, make it yours, and embed it in your app.</p>
        </div>
        <div className="studio-action-group">
          <div className="studio-actions">
            <button
              type="button"
              className="btn"
              disabled={previewBusy}
              onClick={() => {
                flow.resetDefaults();
                brandControls.reset();
                setNotice('');
                setShareFallback('');
              }}
            >
              Reset all
            </button>
            <button type="button" className="btn" disabled={!configured} onClick={share}>
              {copied === 'share' ? 'Copied' : 'Share'}
            </button>
            <button type="button" className="btn btn-primary" disabled={!configured} onClick={copy}>
              {copied === 'embed' ? 'Copied' : 'Copy embed'}
            </button>
          </div>
          <p className="studio-status small" role="status">
            {notice}
          </p>
        </div>
        {shareFallback && (
          <input
            className="input share-link"
            aria-label="Configuration link"
            readOnly
            value={shareFallback}
            onFocus={event => event.target.select()}
          />
        )}
      </div>
      <div className="build-column">
        <fieldset className="segmented builder-tabs" aria-label="Widget configuration">
          {Object.entries(PANELS).map(([key, label]) => (
            <button
              type="button"
              className="btn"
              key={key}
              aria-pressed={panel === key}
              onClick={() => {
                if (key === 'setup' || key === 'appearance' || key === 'integrate') setPanel(key);
              }}
            >
              {label}
            </button>
          ))}
        </fieldset>
        <fieldset className="builder-controls" disabled={previewBusy && panel !== 'integrate'}>
          {panel === 'setup' && <SetupPanel flow={flow} />}
          {panel === 'appearance' && <BrandBar controls={brandControls} />}
          {panel === 'integrate' && (
            <section className="card integration-card">
              <h3>Add it to your app</h3>
              <p className="muted small">
                Take the HTML or React embed, or hand the agent prompt to your coding agent. All three install the
                hosted widget, with its own wallet connection. No SODAX package installation needed.
              </p>
              {configured ? (
                <CodePanel snippets={configured.snippets} initialId="embed" />
              ) : (
                <p className="alert">Choose available assets and valid amounts in Setup to generate code.</p>
              )}
              <details className="disclosure">
                <summary>Partner fees</summary>
                <p className="muted small">
                  {partnerFee
                    ? `This deployment charges a ${partnerFee.percentage / 100}% partner fee, included in every quote.`
                    : 'This deployment has no partner fee.'}{' '}
                  Fees belong to the deployment. To earn fees, the operator must configure your recipient and rate on a
                  dedicated deployment.
                </p>
                <a
                  className="link"
                  href="https://docs.sodax.com/developers/how-to/monetize_sdk#swaps-api-monetization"
                  target="_blank"
                  rel="noreferrer"
                >
                  Partner fee guide ↗
                </a>
              </details>
              <details className="disclosure">
                <summary>Wallet connection &amp; compatibility</summary>
                <p className="muted small">
                  The React export is an iframe wrapper and does not reuse your app’s wallet. WalletConnect needs a
                  project ID on the widget deployment. If a wallet is unavailable inside the frame, users can open the
                  widget in a new tab.
                </p>
              </details>
              <details className="disclosure">
                <summary>Lifecycle events &amp; theme</summary>
                <p className="muted small">
                  Listen for sodax:ready and sodax:swap messages (started, submitted, completed, failed). Check both the
                  widget’s origin and frame identity. Events contain status only, with no wallet addresses or
                  transaction hashes.
                </p>
                <p className="muted small">
                  Send sodax:theme with theme set to light, dark or auto to follow your app’s appearance. These messages
                  never request a signature.
                </p>
              </details>
            </section>
          )}
        </fieldset>
        {previewBusy && (
          <p className="muted small" role="status">
            Finish or close the current wallet or swap flow before changing the configuration.
          </p>
        )}
      </div>
      <div className="preview-column">
        <div className="preview-toolbar">
          <span className="eyebrow">Live preview</span>
          <fieldset className="segmented" aria-label="Preview width">
            <button type="button" className="btn" aria-pressed={!mobile} onClick={() => setMobile(false)}>
              Desktop · 480
            </button>
            <button type="button" className="btn" aria-pressed={mobile} onClick={() => setMobile(true)}>
              Mobile · 375
            </button>
          </fieldset>
        </div>
        <div className="preview-canvas">
          {configured ? (
            <WidgetPreview
              key={configured.preview}
              setupUrl={configured.preview}
              brand={brand}
              mobile={mobile}
              onBusy={setPreviewBusy}
            />
          ) : (
            <p className="muted">
              {flow.assetsError ??
                (flow.isLoadingAssets ? 'Loading available assets…' : 'Complete Setup to preview your widget.')}
            </p>
          )}
          {flow.assetsError && (
            <button className="btn" type="button" onClick={flow.retryAssets}>
              Retry loading assets
            </button>
          )}
        </div>
        <p className="preview-caption muted small">
          Swaps in this preview use real funds. Your exported starting trade is set in Setup.
        </p>
      </div>
    </>
  );
}
