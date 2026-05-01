import React, { useMemo, type ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { ChainKeys, type DeepPartial, type RpcConfig } from '@sodax/types';
import { SodaxProvider } from '@sodax/dapp-kit';
import { productionSolverConfig, stagingSolverConfig, devSolverConfig } from './constants';
import type { SodaxConfig, SolverConfigParams } from '@sodax/sdk';
import { SolverEnv, useAppStore } from './zustand/useAppStore';

const queryClient = new QueryClient();

const rpcConfig: RpcConfig = {
  // evm in dev mode
  [ChainKeys.SONIC_MAINNET]: 'https://sonic-rpc.publicnode.com',
  [ChainKeys.AVALANCHE_MAINNET]: 'https://avalanche-c-chain-rpc.publicnode.com',
  [ChainKeys.BASE_MAINNET]: 'https://base.drpc.org',
  [ChainKeys.BSC_MAINNET]: 'https://bsc.drpc.org',
  [ChainKeys.OPTIMISM_MAINNET]: 'https://optimism-rpc.publicnode.com',
  [ChainKeys.POLYGON_MAINNET]: 'https://polygon-bor-rpc.publicnode.com',
  [ChainKeys.ETHEREUM_MAINNET]: 'https://ethereum-rpc.publicnode.com',
  [ChainKeys.HYPEREVM_MAINNET]: 'https://rpc.hyperliquid.xyz/evm',

  [ChainKeys.SOLANA_MAINNET]:
    process.env.SOLANA_RPC_URL ?? process.env.VITE_SOLANA_RPC_URL ?? 'https://solana-rpc.publicnode.com',
  //stellar
  [ChainKeys.STELLAR_MAINNET]: {
    horizonRpcUrl: 'https://horizon.stellar.org',
    sorobanRpcUrl: 'https://magical-bitter-frost.stellar-mainnet.quiknode.pro/78709b736890cf5a9bcb36e118b9d18e8ecdb7ee',
  },

  // bitcoin — override radfi endpoints (canary)
  // bitcoin: {
  //   rpcUrl: 'https://mempool.space/signet/api',
  //   radfiApiUrl: 'https://staging.api.radfi.co/api', // https://api.canary.radfi.co/api for prod
  //   radfiUmsUrl: 'https://staging.ums.radfi.co/api', // https://ums.radfi.co/api for prod
  // },
  [ChainKeys.BITCOIN_MAINNET]: {
    radfiApiUrl: 'https://api.radfi.co/api',
    radfiUmsUrl: 'https://ums.radfi.co/api',
    rpcUrl: 'https://mempool.space/api',
  },

  // near — single RPC URL
  // [ChainKeys.NEAR_MAINNET]: 'https://free.rpc.fastnear.com',

  // injective — indexer + grpc (fallback to @injectivelabs/networks mainnet defaults)
  // [ChainKeys.INJECTIVE_MAINNET]: {
  // indexer: 'https://your-custom-indexer.injective',
  // grpc: 'https://your-custom-grpc.injective',
  // },

  // stacks — preset name OR custom StacksNetwork object
  // Option 1: preset name
  // [ChainKeys.STACKS_MAINNET]: 'mainnet',
  // Option 2: custom StacksNetwork with baseUrl override (rest from mainnet defaults)
  // [ChainKeys.STACKS_MAINNET]: {
  //   ...networkFrom('mainnet'),
  //   client: { baseUrl: 'https://api.hiro.so' },
  // },

  // icon — single RPC URL
  // [ChainKeys.ICON_MAINNET]: 'https://ctz.solidwallet.io/api/v3',

  // sui — single RPC URL
  // [ChainKeys.SUI_MAINNET]: 'https://fullnode.mainnet.sui.io:443',
};

const configMap: Record<SolverEnv, SolverConfigParams> = {
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
          [ChainKeys.BITCOIN_MAINNET]: rpcConfig[ChainKeys.BITCOIN_MAINNET] ?? {
            rpcUrl: 'https://mempool.space/api',
            radfiApiUrl: 'https://api.radfi.co/api',
            radfiUmsUrl: 'https://ums.radfi.co/api',
          },
        },
      },
      STELLAR: {
        chains: {
          [ChainKeys.STELLAR_MAINNET]: rpcConfig[ChainKeys.STELLAR_MAINNET] ?? {
            horizonRpcUrl: 'https://horizon.stellar.org',
            sorobanRpcUrl: 'https://soroban-mainnet.stellar.org',
          },
        },
      },
      ICON: {},
      INJECTIVE: {},
      NEAR: {},
      STACKS: { chains: { [ChainKeys.STACKS_MAINNET]: 'mainnet' } },
    };
  }, []);

  const sodaxConfig: DeepPartial<SodaxConfig> = useMemo(() => {
    return {
      solver: configMap[solverEnvironment] as DeepPartial<SodaxConfig>['solver'],
    };
  }, [solverEnvironment]);

  return (
    <SodaxProvider testnet={false} config={sodaxConfig} rpcConfig={rpcConfig}>
      <QueryClientProvider client={queryClient}>
        <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}
