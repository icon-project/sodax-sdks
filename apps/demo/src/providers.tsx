import React, { useMemo, type ReactNode } from 'react';

import { QueryClientProvider } from '@tanstack/react-query';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import {
  SodaxProvider,
  createSodaxQueryClient,
  type SodaxOptions,
  type SolverConfig,
  ChainKeys,
  type DeepPartial,
  type HttpUrl,
  type RpcConfig,
} from '@sodax/dapp-kit';
import { productionSolverConfig, stagingSolverConfig } from './constants';
import { SolverEnv, useAppStore } from './zustand/useAppStore';
import { createDatadogLogger } from './lib/loggers/datadogLogger';
import { createDemoAnalytics } from './lib/analytics';

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
  [ChainKeys.SOLANA_MAINNET]: process.env.SOLANA_RPC_URL ?? 'https://solana-rpc.publicnode.com',
  [ChainKeys.SUI_MAINNET]: process.env.SUI_RPC_URL ?? 'https://sui-rpc.publicnode.com',
  [ChainKeys.NEAR_MAINNET]: process.env.NEAR_RPC_URL ?? 'https://free.rpc.fastnear.com',
  [ChainKeys.STELLAR_MAINNET]: {
    horizonRpcUrl: process.env.STELLAR_HORIZON_RPC_URL ?? 'https://horizon.stellar.org',
    sorobanRpcUrl: process.env.STELLAR_SOROBAN_RPC_URL ?? 'https://rpc.ankr.com/stellar_soroban',
  },
  [ChainKeys.BITCOIN_MAINNET]: {
    radfiApiUrl: process.env.RADFI_API_URL ?? 'https://api.bound.exchange/api',
    radfiUmsUrl: process.env.RADFI_UMS_URL ?? 'https://api.ums.bound.exchange/api',
    rpcUrl: process.env.BITCOIN_RPC_URL ?? 'https://mempool.space/api',
  },
};

function isHttpUrl(value: unknown): value is HttpUrl {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));
}

// Read credentials through Vite-scoped env variables, not the inlined process environment.
// The optional base URL includes any deployment prefix; the SDK appends the sponsoring path.
const sponsoringApiBaseUrlEnv: unknown = import.meta.env.VITE_SPONSORING_API_BASE_URL;
const sponsoringApiKeyEnv: unknown = import.meta.env.VITE_SPONSORING_API_KEY;
const sponsoringApiConfig = {
  ...(isHttpUrl(sponsoringApiBaseUrlEnv) ? { baseURL: sponsoringApiBaseUrlEnv } : {}),
  ...(typeof sponsoringApiKeyEnv === 'string' && sponsoringApiKeyEnv.length > 0 ? { apiKey: sponsoringApiKeyEnv } : {}),
};

// Retarget the swaps API, for running the demo against a locally started `swaps-api` instead of
// canary. Same shape as the sponsoring override: the value is the base URL *including* any version
// prefix, so a local service that mounts `/swaps/*` at the bare origin is `http://localhost:3008`.
const swapsApiBaseUrlEnv: unknown = import.meta.env.VITE_SWAPS_API_BASE_URL;
const swapsApiBaseURL = isHttpUrl(swapsApiBaseUrlEnv) ? swapsApiBaseUrlEnv : 'https://canary-api.sodax.com/v1';

const configMap: Record<SolverEnv, SolverConfig> = {
  [SolverEnv.Production]: productionSolverConfig,
  [SolverEnv.Staging]: stagingSolverConfig,
};

export default function Providers({ children }: { children: ReactNode }) {
  const { solverEnvironment } = useAppStore();

  const walletConfig = useMemo((): SodaxWalletConfig => {
    const wcProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
    const walletConnect = wcProjectId ? { projectId: wcProjectId } : undefined;

    return {
      EVM: {
        // Hydration-timing flag, not "is host app SSR". Keep `true` so wagmi
        // defers its reconnect into `useEffect` and avoids React's "setState
        // during render" warning. See issue #129.
        ssr: true,
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
      SUI: {
        chains: {
          [ChainKeys.SUI_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.SUI_MAINNET] },
        },
      },
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
      NEAR: {
        chains: {
          [ChainKeys.NEAR_MAINNET]: {
            rpcUrl: rpcConfig[ChainKeys.NEAR_MAINNET],
          },
        },
      },
      STACKS: { chains: { [ChainKeys.STACKS_MAINNET]: 'mainnet' } },
    };
  }, []);

  // override sodax config for rpc urls and solver config
  const sodaxConfig: SodaxOptions = useMemo(() => {
    // Opt-in observability sink (Sentry + Datadog), enabled via VITE_ENABLE_OBSERVABILITY.
    // `undefined` when off, which leaves the SDK on its default console logger.
    return {
      api: {
        baseApiConfig: {
          baseURL: 'https://api.sodax.com/v1/be',
        },
        swapsApiConfig: {
          baseURL: swapsApiBaseURL,
        },
        sponsoringApiConfig,
      },
      logger: createDatadogLogger(),
      // Opt-in user-action analytics (issue #175). Enabled by default in the demo; the sink logs each
      // event and re-emits it as a `sodax:analytics` window CustomEvent. `false` when disabled, which
      // leaves the SDK on its default (analytics off).
      analytics: createDemoAnalytics() ?? false,
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
        [ChainKeys.SUI_MAINNET]: { rpc_url: rpcConfig[ChainKeys.SUI_MAINNET] },
        [ChainKeys.NEAR_MAINNET]: { rpcUrl: rpcConfig[ChainKeys.NEAR_MAINNET] },
        [ChainKeys.STELLAR_MAINNET]: rpcConfig[ChainKeys.STELLAR_MAINNET],
        [ChainKeys.BITCOIN_MAINNET]: rpcConfig[ChainKeys.BITCOIN_MAINNET],
      },
    };
  }, [solverEnvironment]);

  // `SodaxProvider` freezes its config at first render (read-once via `useRef`), so
  // setting `solverEnvironment` doesn't take effect on its own. Keying the provider on the
  // env forces a clean unmount/remount whenever it changes — the SDK reinitialises with the
  // new solver endpoint. Wallet state is preserved (it lives below in `SodaxWalletProvider`,
  // which is *outside* the keyed scope is what we'd ideally want — but the wallet provider
  // is keyed on the SDK provider tree and doesn't carry per-config state, so unmount cost
  // is just a fresh React Query cache).
  return (
    <SodaxProvider key={solverEnvironment} config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>
        <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}
