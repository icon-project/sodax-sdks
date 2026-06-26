import { ConnectWallet } from '@/components/ConnectWallet';
import { SwapCard } from '@/components/SwapCard';

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">@sodax/swaps-api</h1>
          <p className="text-xs text-muted-foreground">
            Swap UI powered by the minimal swaps-api client (wallet only signs)
          </p>
        </div>
        <ConnectWallet />
      </header>
      <main className="flex justify-center px-6 py-12">
        <SwapCard />
      </main>
    </div>
  );
}
