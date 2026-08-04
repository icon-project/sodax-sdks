import { SodaxProvider, createSodaxQueryClient, type SodaxOptions } from '@sodax/dapp-kit';
import { ChainKeys, spokeChainConfig } from '@sodax/types';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LabProvider } from './lab/LabContext';
import { createLabAnalytics, toSerializable, type LabLogStore } from './lab/log';
import type { ResolvedLabTargets } from './lab/labConfig';

const STELLAR = spokeChainConfig[ChainKeys.STELLAR_MAINNET];

// The wallet provider freezes config; remounting to repoint it would disconnect the wallet.
const walletConfig: SodaxWalletConfig = {
  STELLAR: {
    chains: {
      [ChainKeys.STELLAR_MAINNET]: {
        horizonRpcUrl: STELLAR.horizonRpcUrl,
        sorobanRpcUrl: STELLAR.sorobanRpcUrl,
      },
    },
  },
};

function buildSodaxConfig(
  resolved: ResolvedLabTargets,
  apiKey: string,
  timeoutMs: number,
  analytics: SodaxOptions['analytics'],
): SodaxOptions {
  return {
    api: {
      sponsoringApiConfig: {
        ...(resolved.sponsoringBaseUrl ? { baseURL: resolved.sponsoringBaseUrl } : {}),
        timeout: timeoutMs,
        headers: {},
        // Empty must send no header so the lab can exercise the genuine 401 path.
        ...(apiKey ? { apiKey } : {}),
      },
    },
    chains: {
      [ChainKeys.STELLAR_MAINNET]: {
        ...STELLAR,
        horizonRpcUrl: resolved.horizonRpcUrl,
        sorobanRpcUrl: resolved.sorobanRpcUrl,
      },
    },
    analytics,
  };
}

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <LabProvider defaultHorizonRpcUrl={STELLAR.horizonRpcUrl} defaultSorobanRpcUrl={STELLAR.sorobanRpcUrl}>
      {({ resolved, apiKey, timeoutMs, log }) => (
        <SodaxRuntime resolved={resolved} apiKey={apiKey} timeoutMs={timeoutMs} log={log}>
          {children}
        </SodaxRuntime>
      )}
    </LabProvider>
  );
}

function SodaxRuntime({
  resolved,
  apiKey,
  timeoutMs,
  log,
  children,
}: {
  resolved: ResolvedLabTargets;
  apiKey: string;
  timeoutMs: number;
  log: LabLogStore;
  children: ReactNode;
}) {
  const analytics = useMemo(() => createLabAnalytics(log), [log]);

  const sodaxConfig = useMemo(
    () => buildSodaxConfig(resolved, apiKey, timeoutMs, analytics),
    [resolved, apiKey, timeoutMs, analytics],
  );

  // The callback outlives target changes, so read the current fingerprint through a ref.
  const fingerprintRef = useRef(resolved.fingerprint);
  fingerprintRef.current = resolved.fingerprint;

  // Keep one client: mounted observers never rebind, and replacement tears down browser subscriptions.
  const [queryClient] = useState(() =>
    createSodaxQueryClient({
      onMutationError: error => {
        log.append({
          kind: 'mutationError',
          label: `mutation failed · ${fingerprintRef.current}`,
          detail: toSerializable(error),
        });
      },
    }),
  );

  // Sponsoring query keys omit the base URL, so target changes must clear the live client.
  const lastFingerprint = useRef(resolved.fingerprint);
  useEffect(() => {
    if (lastFingerprint.current === resolved.fingerprint) return;
    lastFingerprint.current = resolved.fingerprint;
    queryClient.clear();
  }, [resolved.fingerprint, queryClient]);

  return (
    <SodaxProvider config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>
        <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}
