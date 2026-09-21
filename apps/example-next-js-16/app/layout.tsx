import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { createWagmiConfig, tryCookieToInitialState } from '@sodax/wallet-sdk-react/xchains/evm';
import Providers from './providers';

export const metadata = { title: 'sodax next16 repro' };

// Match the runtime SodaxWalletProvider — pass no `EVM.chains`, so both this
// SSR-side wagmi config and the client-side one created inside the provider
// use the SDK's default EVM chain set + transports. Single source of truth =
// no cookie/runtime drift on wagmi version bumps or new chains.
const wagmiConfig = createWagmiConfig();

export default async function RootLayout({ children }: { children: ReactNode }) {
  // tryCookieToInitialState (not wagmi's cookieToInitialState) so a malformed cookie can't throw during SSR.
  const initialState = tryCookieToInitialState(wagmiConfig, (await headers()).get('cookie'));

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers initialState={initialState}>{children}</Providers>
      </body>
    </html>
  );
}
