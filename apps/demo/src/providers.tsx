import React, { useMemo, type ReactNode } from 'react';

import { QueryClientProvider } from '@tanstack/react-query';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { SodaxProvider, createSodaxQueryClient } from '@sodax/dapp-kit';
import { productionSolverConfig, stagingSolverConfig, devSolverConfig } from './constants';
import { type SodaxConfig, type SolverConfig, ChainKeys, type DeepPartial, type RpcConfig } from '@sodax/sdk';
import { SolverEnv, useAppStore } from './zustand/useAppStore';

const queryClient = createSodaxQueryClient();

const rpcConfig: RpcConfig = {
  [ChainKeys.SONIC_MAINNET]: process.env.SONIC_RPC_URL ?? 'https://sonic-rpc.publicnode.com',
  [ChainKeys.AVALANCHE_MAINNET]: process.env.AVALANCHE_RPC_URL ?? 'https://avalanche-c-chain-rpc.publicnode.com',
  [ChainKeys.BASE_MAINNET]: process.env.BASE_RPC_URL ?? 'https://base.drpc.org',
  [ChainKeys.BSC_MAINNET]: process.env.BSC_RPC_URL ?? 'https://bsc.drpc.org',
  [ChainKeys.OPTIMISM_MAINNET]: process.env.OPTIMISM_RPC_URL ?? 'https://optimism-rpc.publicnode.com',
  [ChainKeys.POLYGON_MAINNET]: process.env.POLYGON_RPC_URL ?? 'https://polygon-bor-rpc.publicnode.com',
  [ChainKeys.ETHEREUM_MAINNET]: process.env.ETHEREUM_RPC_URL ?? 'https://ethereum-rpc.publicnode.com',
  [ChainKeys.HYPEREVM_MAINNET]: process.env.HYPEREVM_RPC_URL ?? 'https://rpc.hyperliquid.xyz/evm',
  [ChainKeys.SOLANA_MAINNET]:
    process.env.SOLANA_RPC_URL ?? 'https://solana-rpc.publicnode.com',
  [ChainKeys.STELLAR_MAINNET]: {
    horizonRpcUrl: process.env.STELLAR_HORIZON_RPC_URL ?? 'https://horizon.stellar.org',
    sorobanRpcUrl:
      process.env.STELLAR_SOROBAN_RPC_URL ??
      'https://magical-bitter-frost.stellar-mainnet.quiknode.pro/78709b736890cf5a9bcb36e118b9d18e8ecdb7ee',
  },
  [ChainKeys.BITCOIN_MAINNET]: {
    radfiApiUrl: process.env.RADFI_API_URL ?? 'https://api.radfi.co/api',
    radfiUmsUrl: process.env.RADFI_UMS_URL ?? 'https://ums.radfi.co/api',
    rpcUrl: process.env.BITCOIN_RPC_URL ?? 'https://mempool.space/api',
  },
};

const configMap: Record<SolverEnv, SolverConfig> = {
  [SolverEnv.Production]: productionSolverConfig,
  [SolverEnv.Staging]: stagingSolverConfig,
  [SolverEnv.Dev]: devSolverConfig,
};

export default function Providers({ children }: { children: ReactNode }) {
  const { solverEnvironment } = useAppStore();

  const walletConfig = useMemo((): SodaxWalletConfig => {
    const wcProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
    const walletConnect = wcProjectId ? { projectId: wcProjectId } : undefined;

    return {
      EVM: {
        ssr: false,
        reconnectOnMount: true,
        walletConnect,
        chains: {
          [ChainKeys.SONIC_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.SONIC_MAINNET] },
          [ChainKeys.AVALANCHE_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.AVALANCHE_MAINNET] },
          [ChainKeys.BASE_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.BASE_MAINNET] },
          [ChainKeys.BSC_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.BSC_MAINNET] },
          [ChainKeys.OPTIMISM_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.OPTIMISM_MAINNET] },
          [ChainKeys.POLYGON_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.POLYGON_MAINNET] },
          [ChainKeys.HYPEREVM_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.HYPEREVM_MAINNET] },
          // EVM example: tighter confirmations on Arbitrum, longer timeout on Ethereum.
          [ChainKeys.ARBITRUM_MAINNET]: {
            rpcUrl: rpcConfig[ChainKeys.ARBITRUM_MAINNET],
            defaults: { waitForTransactionReceipt: { confirmations: 1, timeout: 60_000 } },
          },
          [ChainKeys.ETHEREUM_MAINNET]: {
            rpcUrl: rpcConfig[ChainKeys.ETHEREUM_MAINNET],
            defaults: { waitForTransactionReceipt: { confirmations: 3, timeout: 180_000 } },
          },
        },
      },
      SOLANA: {
        chains: {
          [ChainKeys.SOLANA_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.SOLANA_MAINNET] },
        },
      },
      SUI: {},
      BITCOIN: {
        chains: {
          [ChainKeys.BITCOIN_MAINNET]: rpcConfig[ChainKeys.BITCOIN_MAINNET],
        },
      },
      STELLAR: {
        chains: {
          [ChainKeys.STELLAR_MAINNET]: rpcConfig[ChainKeys.STELLAR_MAINNET],
        },
      },
      ICON: {},
      INJECTIVE: {},
      NEAR: {},
      STACKS: { chains: { [ChainKeys.STACKS_MAINNET]: 'mainnet' } },
    };
  }, []);

  // override sodax config for rpc urls and solver config
  const sodaxConfig: DeepPartial<SodaxConfig> = useMemo(() => {
    return {
      solver: configMap[solverEnvironment],
      chains: {
        [ChainKeys.SONIC_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.SONIC_MAINNET] },
        [ChainKeys.AVALANCHE_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.AVALANCHE_MAINNET] },
        [ChainKeys.BASE_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.BASE_MAINNET] },
        [ChainKeys.BSC_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.BSC_MAINNET] },
        [ChainKeys.OPTIMISM_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.OPTIMISM_MAINNET] },
        [ChainKeys.POLYGON_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.POLYGON_MAINNET] },
        [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.ETHEREUM_MAINNET] },
        [ChainKeys.HYPEREVM_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.HYPEREVM_MAINNET] },
        [ChainKeys.SOLANA_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.SOLANA_MAINNET] },
        [ChainKeys.STELLAR_MAINNET]: rpcConfig[ChainKeys.STELLAR_MAINNET],
        [ChainKeys.BITCOIN_MAINNET]: rpcConfig[ChainKeys.BITCOIN_MAINNET],
      },
    };
  }, [solverEnvironment]);

  return (
    <SodaxProvider config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>
        <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}
