import { CodePanel } from './components/CodePanel';
import { SwapPanel } from './components/SwapPanel';
import { ThemeToggle } from './components/ThemeToggle';
import { WalletBar } from './components/WalletBar';
import { playgroundMode } from './config';
import { useSwapFlow } from './hooks/useSwapFlow';

export default function App() {
  const flow = useSwapFlow();

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>SODAX SDK Playground</h1>
          <p className="subtitle">
            A live cross-network swap built with <code>@sodax/dapp-kit</code>. Quoting needs no wallet.
          </p>
        </div>
        <div className="header-actions">
          <WalletBar />
          <ThemeToggle />
        </div>
      </header>

      {playgroundMode === 'full' && (
        <p className="banner">Mainnet only — there is no testnet. Approving and swapping here moves real funds.</p>
      )}

      <main className="app-main">
        <SwapPanel flow={flow} />
        <CodePanel flow={flow} />
      </main>

      <footer className="app-footer muted small">
        Non-custodial: SODAX routes and settles the intent; admitted solvers compete to fill it.
      </footer>
    </div>
  );
}
