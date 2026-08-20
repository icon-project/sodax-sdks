import { ConnectWallet } from '@/components/ConnectWallet';
import { SwapCard } from '@/components/SwapCard';

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-cherry-soda font-mono text-sm font-bold text-white">
            s
          </span>
          <span className="font-semibold tracking-tight">swaps-api</span>
        </div>
        <ConnectWallet />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        <SwapCard />
        <p className="mt-6 max-w-[460px] text-center text-xs text-muted-foreground">
          Every call here goes through <span className="font-mono text-foreground">@sodax/swaps-api</span> — the wallet
          only signs the transactions the backend returns. No SDK, no dapp-kit.
        </p>
      </main>
    </div>
  );
}
