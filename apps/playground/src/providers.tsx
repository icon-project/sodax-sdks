import { SodaxProvider, type SodaxOptions, createSodaxQueryClient } from '@sodax/dapp-kit';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { swapsApiKey } from './config';

const queryClient = createSodaxQueryClient();

// SodaxProvider freezes its config by reference on first render, so this stays a module constant.
const sodaxConfig: SodaxOptions = swapsApiKey ? { apiKey: swapsApiKey } : {};

/**
 * No wallet provider and no `chains` override: the widget's only network call is the SODAX swaps
 * API, so it opens no RPC connection and there is no endpoint to configure. Mounting the wallet
 * layer would also be the only way this page could ever spend a visitor's funds.
 */
export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SodaxProvider config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </SodaxProvider>
  );
}
