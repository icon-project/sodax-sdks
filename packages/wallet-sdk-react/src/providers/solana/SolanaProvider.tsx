import type { ReactNode } from 'react';
import {
  ConnectionProvider as SolanaConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from '@solana/wallet-adapter-react';
import { ChainKeys } from '@sodax/types';
import type { SolanaTypeConfig } from '../../types/config.js';
import { SolanaHydrator } from './SolanaHydrator.js';
import { SolanaActions } from './SolanaActions.js';
import { SOLANA_DEFAULT_AUTO_CONNECT, SOLANA_DEFAULT_RPC_URL } from '../../constants.js';

const emptyWallets: [] = [];

type SolanaProviderProps = {
  children: ReactNode;
  /** Solana type slot — adapter settings + nested chain entries. */
  config: SolanaTypeConfig;
};

export const SolanaProvider = ({ children, config }: SolanaProviderProps) => {
  const autoConnect = config.autoConnect ?? SOLANA_DEFAULT_AUTO_CONNECT;
  const endpoint = config.chains?.[ChainKeys.SOLANA_MAINNET]?.rpcUrl ?? SOLANA_DEFAULT_RPC_URL;

  return (
    <SolanaConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={emptyWallets} autoConnect={autoConnect}>
        <SolanaHydrator />
        <SolanaActions />
        {children}
      </SolanaWalletProvider>
    </SolanaConnectionProvider>
  );
};
