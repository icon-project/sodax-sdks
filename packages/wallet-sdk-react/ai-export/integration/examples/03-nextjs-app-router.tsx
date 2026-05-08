/**
 * Next.js 15 App Router setup with SSR-safe hydration.
 *
 * File layout in your project:
 *   app/
 *   ├── layout.tsx     ← server component (this file's RootLayout)
 *   ├── providers.tsx  ← client component (this file's Providers)
 *   └── page.tsx       ← server or client component, may use hooks if 'use client'
 *
 * Key SSR points:
 * - EVM.ssr: true     (wagmi cookies-based hydration)
 * - 'use client' on  every component that calls a hook from this package
 * - QueryClient as a module constant (one client per app, never recreated)
 * - SodaxWalletProvider config also a module constant (frozen on first render)
 */

// ============================================================
// app/layout.tsx — server component
// ============================================================
import type { ReactNode } from 'react';
import { Providers } from './providers';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

// ============================================================
// app/providers.tsx — client component
// ============================================================
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';
import type { ReactNode } from 'react';

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
// app/page.tsx — client component (because we use a hook)
// ============================================================
'use client';

import { useConnectedChains } from '@sodax/wallet-sdk-react';

export default function Home() {
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
