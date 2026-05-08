import { useMemo, useRef, type ReactNode, type ReactElement } from 'react';
import { Sodax, type SodaxConfig } from '@sodax/sdk';
import { SodaxContext } from '@/contexts/index.js';
import type { DeepPartial } from '@sodax/sdk';

interface SodaxProviderProps {
  children: ReactNode;
  /**
   * Sodax config (overrides defaults including rpcUrls). **Read-once at mount** —
   * changes after first render are ignored to prevent re-instantiating the SDK
   * from unstable parent references. To switch config (e.g. testnet ↔ mainnet),
   * unmount/remount the provider.
   */
  config?: DeepPartial<SodaxConfig>;
}

export const SodaxProvider = ({ children, config }: SodaxProviderProps): ReactElement => {
  // Freeze config on first render so the SDK instance and consumers share one
  // snapshot (matches SodaxWalletProvider semantic).
  const configRef = useRef<DeepPartial<SodaxConfig> | undefined>(config);
  const frozen = configRef.current;
  const sodax = useMemo(() => new Sodax(frozen), [frozen]);

  return <SodaxContext.Provider value={{ sodax }}>{children}</SodaxContext.Provider>;
};
