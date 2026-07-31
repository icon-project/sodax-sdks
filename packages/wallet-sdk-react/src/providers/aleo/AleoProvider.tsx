import { type ComponentProps, type ReactNode, useMemo } from 'react';
import { AleoWalletProvider as NativeAleoWalletProvider } from '@provablehq/aleo-wallet-adaptor-react';
import { ShieldWalletAdapter } from '@provablehq/aleo-wallet-adaptor-shield';
import { DecryptPermission } from '@provablehq/aleo-wallet-adaptor-core';
import type { AleoTypeConfig } from '../../types/config.js';
import { ALEO_DEFAULT_AUTO_CONNECT, ALEO_DEFAULT_NETWORK } from '../../constants.js';
import { AleoHydrator } from './AleoHydrator.js';
import { AleoActions } from './AleoActions.js';

// `wallets` and `network` prop types are sourced via ComponentProps to bridge
// the transitive @provablehq/aleo-types version skew between adaptor-react
// (built against alpha.1) and our resolved alpha.3.
type NativeProviderProps = ComponentProps<typeof NativeAleoWalletProvider>;
type NativeWalletAdapter = NativeProviderProps['wallets'][number];
type NativeNetwork = NativeProviderProps['network'];

function buildDefaultAdapters(): NativeWalletAdapter[] {
  return [new ShieldWalletAdapter({}) as NativeWalletAdapter];
}

type AleoProviderProps = {
  children: ReactNode;
  /** Aleo type slot — adapter settings + nested chain entries. */
  config: AleoTypeConfig;
};

export const AleoProvider = ({ children, config }: AleoProviderProps) => {
  const autoConnect = config.autoConnect ?? ALEO_DEFAULT_AUTO_CONNECT;
  const network = (config.network ?? ALEO_DEFAULT_NETWORK) as NativeNetwork;

  // Build once per mount — adapter instances hold their own connection state
  // and re-creating them on every render would reset detection.
  const wallets = useMemo(() => buildDefaultAdapters(), []);

  return (
    <NativeAleoWalletProvider
      wallets={wallets}
      network={network}
      autoConnect={autoConnect}
      decryptPermission={DecryptPermission.NoDecrypt}
    >
      <AleoHydrator />
      <AleoActions />
      {children}
    </NativeAleoWalletProvider>
  );
};
