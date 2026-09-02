import { useState } from 'react';
import { FlowRail } from './components/FlowRail';
import { ThemeToggle } from './components/ThemeToggle';
import { WalletBar } from './components/WalletBar';
import { playgroundMode } from './config';
import type { Flow } from './lib/flows';
import { initialUrl } from './lib/initialUrl';
import { BridgeView } from './views/BridgeView';
import { SwapView } from './views/SwapView';

export default function App() {
  const [flow, setFlow] = useState<Flow>(initialUrl.flow ?? 'swap');

  return (
    <div className="app">
      {/* A bar, not a hero: the app title belongs to the flow below, the way the exchange reads. */}
      <header className="app-header">
        <h1 className="app-title">
          SODAX SDK <em>playground</em>
        </h1>
        {playgroundMode === 'full' && (
          <p className="hero-note">
            <strong>Mainnet</strong> — no testnet exists; signing moves real funds.
          </p>
        )}
        <div className="header-actions">
          <WalletBar />
          <ThemeToggle />
        </div>
      </header>

      <div className="app-shell">
        <FlowRail flow={flow} onChange={setFlow} />

        {/* Only the active flow mounts, so the other runs no queries and never writes the URL. */}
        <main className="app-main">{flow === 'swap' ? <SwapView /> : <BridgeView />}</main>
      </div>

      <footer className="app-footer muted small">
        Non-custodial: SODAX routes and settles. Admitted solvers compete to fill a swap; a bridge moves through the hub
        vaults.
      </footer>
    </div>
  );
}
