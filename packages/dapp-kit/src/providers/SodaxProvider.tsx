import type { ReactNode, ReactElement } from 'react';
import { Sodax, type SodaxConfig } from '@sodax/sdk';
import { SodaxContext } from '@/contexts/index.js';
import type { DeepPartial } from '@sodax/sdk';

interface SodaxProviderProps {
  children: ReactNode;
  config?: DeepPartial<SodaxConfig>; // optional sodax config to override the default config (including rpcUrls)
}

export const SodaxProvider = ({ children, config }: SodaxProviderProps): ReactElement => {
  const sodax = new Sodax(config);

  return <SodaxContext.Provider value={{ sodax }}>{children}</SodaxContext.Provider>;
};
