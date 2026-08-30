import { useState } from 'react';
import { FlowTabs } from './components/FlowTabs';
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
      <header className="app-header">
        <div className="app-title">
          <h1>
            SODAX SDK <em>playground</em>
          </h1>
          <p className="subtitle">
            Live cross-network flows built with <code>@sodax/dapp-kit</code>, beside the code that produced them.
            Reading a quote needs no wallet.
          </p>
          {playgroundMode === 'full' && (
            <p className="hero-note">
              <strong>Mainnet only</strong> — there is no testnet. Approving, swapping and bridging move real funds.
            </p>
          )}
        </div>
        <div className="header-actions">
          <WalletBar />
          <ThemeToggle />
        </div>
      </header>

      <FlowTabs flow={flow} onChange={setFlow} />

      {/* Only the active flow mounts, so the other runs no queries and never writes the URL. */}
      <main className="app-main">{flow === 'swap' ? <SwapView /> : <BridgeView />}</main>

      <footer className="app-footer muted small">
        Non-custodial: SODAX routes and settles. Admitted solvers compete to fill a swap; a bridge moves through the hub
        vaults.
      </footer>
    </div>
  );
}
