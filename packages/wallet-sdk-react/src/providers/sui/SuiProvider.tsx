import type { ReactNode } from 'react';
import { ChainKeys } from '@sodax/types';
import { SuiClientProvider, WalletProvider as SuiWalletProvider } from '@mysten/dapp-kit';
import { getFullnodeUrl } from '@mysten/sui/client';
import type { SuiTypeConfig } from '../../types/config.js';
import { SuiHydrator } from './SuiHydrator.js';
import { SuiActions } from './SuiActions.js';
import { SUI_DEFAULT_AUTO_CONNECT, SUI_DEFAULT_NETWORK } from '../../constants.js';

type SuiProviderProps = {
  children: ReactNode;
  /** Sui type slot — adapter settings + nested chain entries. */
  config: SuiTypeConfig;
};

export const SuiProvider = ({ children, config }: SuiProviderProps) => {
  const autoConnect = config.autoConnect ?? SUI_DEFAULT_AUTO_CONNECT;
  const network = config.network ?? SUI_DEFAULT_NETWORK;
  const rpcUrl = config.chains?.[ChainKeys.SUI_MAINNET]?.rpcUrl ?? getFullnodeUrl(network);

  return (
    <SuiClientProvider networks={{ [network]: { url: rpcUrl } }} defaultNetwork={network}>
      <SuiWalletProvider autoConnect={autoConnect}>
        <SuiHydrator />
        <SuiActions />
        {children}
      </SuiWalletProvider>
    </SuiClientProvider>
  );
};
