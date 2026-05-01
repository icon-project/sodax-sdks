'use client';

import { type ReactNode, useRef } from 'react';

import type { SodaxWalletConfig } from './types/config.js';
import { WalletConfigProvider } from './context/WalletConfigContext.js';
import { EvmProvider } from './providers/evm/index.js';
import { SolanaProvider } from './providers/solana/index.js';
import { SuiProvider } from './providers/sui/index.js';
import { useInitChainServices } from './hooks/useInitChainServices.js';

export type SodaxWalletProviderProps = {
  children: ReactNode;
  /**
   * Captured once on mount. Dynamic changes require remounting `SodaxWalletProvider`
   * — passing a new reference on subsequent renders has no effect.
   */
  config: SodaxWalletConfig;
};

export const SodaxWalletProvider = ({ children, config }: SodaxWalletProviderProps) => {
  // Freeze config on first render so context, store, and wagmi all share one snapshot
  // and unstable parent references can't trigger re-init.
  const configRef = useRef<SodaxWalletConfig>(config);
  const frozen = configRef.current;

  useInitChainServices(frozen);

  let content = <>{children}</>;

  if (frozen.SOLANA) {
    content = <SolanaProvider config={frozen.SOLANA}>{content}</SolanaProvider>;
  }

  if (frozen.SUI) {
    content = <SuiProvider config={frozen.SUI}>{content}</SuiProvider>;
  }

  if (frozen.EVM) {
    content = <EvmProvider config={frozen.EVM}>{content}</EvmProvider>;
  }

  return <WalletConfigProvider value={frozen}>{content}</WalletConfigProvider>;
};
