import { ThemeToggle } from './components/ThemeToggle';
import { useSwapFlow } from './hooks/useSwapFlow';
import { initialUrl } from './lib/initialUrl';
import { SwapView, SwapWidget } from './views/SwapView';

export default function App() {
  const flow = useSwapFlow();

  // What a host page frames: the widget, nothing around it. The demo chrome below is ours.
  if (initialUrl.embed) {
    return (
      <div className="app app-embed">
        <SwapWidget flow={flow} />
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
          <strong>Live mainnet quotes</strong> — no wallet, no signing, nothing to spend.
        </p>
        <div className="header-actions">
          <ThemeToggle />
        </div>
      </header>

      {/* The exchange's stage: one rounded panel on the cherry ground, holding the whole app. */}
      <div className="stage">
        <main className="app-main">
          <SwapView flow={flow} />
        </main>

        <footer className="app-footer muted small">
          Non-custodial: SODAX routes and settles, and admitted solvers compete to fill. Quotes come from the same API
          that serves sodax.com/exchange/swap.
        </footer>
      </div>
    </div>
  );
}
