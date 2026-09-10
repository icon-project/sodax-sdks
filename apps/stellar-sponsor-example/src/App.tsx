import { useEffect } from 'react';
import ConnectStellarWallet from './components/ConnectStellarWallet';
import ViewTabs from './components/ViewTabs';
import { LAB_ENABLED } from './lib/labEnabled';
import { normalizeHash, useHashView, type ViewId } from './lib/useHashView';
import LabView from './lab/LabView';
import ShowcaseView from './views/ShowcaseView';

const HIDDEN_VIEWS: readonly ViewId[] = LAB_ENABLED ? [] : ['lab'];

export default function App() {
  const { view, setView } = useHashView();

  useEffect(normalizeHash, []);

  const active: ViewId = view === 'lab' && !LAB_ENABLED ? 'showcase' : view;

  return (
    <div className="min-h-dvh text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold">Stellar account activation</h1>
            <span className="rounded-full border border-warning-border bg-warning-surface px-2 py-0.5 text-[0.6875rem] font-medium text-warning">
              mainnet only
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Sponsored reserves via @sodax/dapp-kit</p>
        </div>
        <ConnectStellarWallet />
      </header>

      <ViewTabs view={active} setView={setView} hiddenViews={HIDDEN_VIEWS} />

      <main className="mx-auto w-full max-w-5xl px-6 py-8">{active === 'lab' ? <LabView /> : <ShowcaseView />}</main>
    </div>
  );
}
