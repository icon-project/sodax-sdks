/**
 * Next.js 15 App Router setup with SSR-safe hydration.
 *
 * This file shows three separate files merged into one for reference. In your
 * project, split them into the matching paths:
 *
 *   app/
 *   ├── layout.tsx     ← server component (RootLayout below — make it the file's `export default`)
 *   ├── providers.tsx  ← client component (Providers below — needs `'use client'` at top of file)
 *   └── page.tsx       ← client component (Home below — needs `'use client'` at top of file)
 *
 * Key SSR points:
 * - `EVM.ssr: true` enables wagmi cookie-based hydration.
 * - `'use client'` on every component that calls a hook from this package.
 * - QueryClient as a module constant — one client per app, never recreated.
 * - SodaxWalletProvider config also a module constant — frozen on first render.
 *
 * NOTE: this combined file uses named exports only so it lints clean. Each of
 * `RootLayout`, `Providers`, and `Home` should be the `export default` of its
 * own file in your real project.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SodaxWalletProvider, type SodaxWalletConfig, useConnectedChains } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';
import type { ReactNode } from 'react';

// ============================================================
// app/providers.tsx — client component
// (top of file: `'use client';`)
// ============================================================

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60 * 1000 },
  },
});

const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true, // ← required for Next.js — enables wagmi cookies hydration
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://ethereum-rpc.publicnode.com' },
      [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc-dataseed.binance.org' },
    },
  },
};

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
    </QueryClientProvider>
  );
}

// ============================================================
// app/layout.tsx — server component
// (no `'use client'`; in your real file, change `export function` to `export default function`)
// ============================================================

export function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

// ============================================================
// app/page.tsx — client component (because we use a hook)
// (top of file: `'use client';`; change `export function` to `export default function`)
// ============================================================

export function Home() {
  // Gate UI on hydration to prevent reload flicker
  const { chains, status } = useConnectedChains();

  if (status === 'loading') {
    return <p>Loading…</p>;
  }

  if (chains.length === 0) {
    return <p>No wallets connected</p>;
  }

  return (
    <ul>
      {chains.map((c) => (
        <li key={c.chainType}>
          {c.chainType}: <code>{c.account.address}</code>
        </li>
      ))}
    </ul>
  );
}
