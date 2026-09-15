import { useEmbedSize } from './hooks/useEmbedSize';
import { useBrand } from './hooks/useBrand';
import { useSwapFlow } from './hooks/useSwapFlow';
import { initialUrl } from './lib/initialUrl';
import { SwapView, SwapWidget } from './views/SwapView';

export default function App() {
  const brand = useBrand();
  const flow = useSwapFlow({ brand: brand.brand });
  useEmbedSize(initialUrl.embed);
  const standalone = new URL(window.location.href);
  standalone.searchParams.delete('embed');

  // What a host page frames: the widget, nothing around it. The demo chrome below is ours.
  if (initialUrl.embed) {
    return (
      <div className="app app-embed">
        <SwapWidget flow={flow} />
        <a className="link standalone-link" href={standalone.href} target="_blank" rel="noreferrer">
          Open in a new tab ↗
        </a>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          SODAX swap <em>widget</em>
        </h1>
        <p className="hero-note">
          <a href="https://docs.sodax.com/" target="_blank" rel="noreferrer">
            Developer docs ↗
          </a>
        </p>
      </header>

      {/* The exchange's stage: one rounded panel on the cherry ground, holding the whole app. */}
      <div className="stage">
        <main className="app-main">
          <SwapView flow={flow} brandControls={brand} />
        </main>

        <footer className="app-footer muted small">Built with SODAX. Non-custodial swaps across networks.</footer>
      </div>
    </div>
  );
}
