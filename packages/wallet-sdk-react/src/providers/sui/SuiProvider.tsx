import { useMemo, type ReactNode } from 'react';
import { ChainKeys } from '@sodax/types';
import { createDAppKit, DAppKitProvider } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { SuiTypeConfig } from '@/types/config.js';
import { SuiHydrator } from './SuiHydrator.js';
import { SuiActions } from './SuiActions.js';
import { SUI_DEFAULT_AUTO_CONNECT, SUI_DEFAULT_GRPC_URLS, SUI_DEFAULT_NETWORK } from '@/constants.js';

type SuiProviderProps = {
  children: ReactNode;
  /** Sui type slot — adapter settings + nested chain entries. */
  config: SuiTypeConfig;
};

export const SuiProvider = ({ children, config }: SuiProviderProps) => {
  const autoConnect = config.autoConnect ?? SUI_DEFAULT_AUTO_CONNECT;
  const network = config.network ?? SUI_DEFAULT_NETWORK;
  const suiChain = config.chains?.[ChainKeys.SUI_MAINNET];
  // `rpcUrl` is the pre-gRPC name, still honored so existing configs keep working.
  const grpcUrl = suiChain?.grpcUrl ?? suiChain?.rpcUrl ?? SUI_DEFAULT_GRPC_URLS[network];

  if (!grpcUrl) {
    throw new Error(`[SuiProvider] no default gRPC endpoint for network "${network}" — pass chains.sui.grpcUrl`);
  }

  // dApp Kit registers wallets as a side effect of creation, so it must be built once.
  // `SodaxWalletProvider` freezes the wallet config on first render, so these deps are stable.
  const dAppKit = useMemo(
    () =>
      createDAppKit({
        networks: [network],
        createClient: () => new SuiGrpcClient({ network, baseUrl: grpcUrl }),
        autoConnect,
      }),
    [network, grpcUrl, autoConnect],
  );

  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <SuiHydrator grpcUrl={grpcUrl} />
      <SuiActions />
      {children}
    </DAppKitProvider>
  );
};
