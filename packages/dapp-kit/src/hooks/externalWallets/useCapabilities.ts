import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { IGaslessCapableEvmWalletProvider } from '@sodax/sdk';
import type { ReadHookParams } from '../shared/types.js';

/**
 * EIP-5792 capabilities for a single chain — a mirror of wagmi/viem's `WalletCapabilities`,
 * typed for the fields SODAX reads (`atomic`, `paymasterService`) and left open for the rest.
 */
export type WalletCapabilities = {
  atomic?: { status?: 'unsupported' | 'supported' | 'ready' };
  paymasterService?: { supported?: boolean };
  [capability: string]: unknown;
};

/** Per-chain capabilities keyed by numeric chain id — the shape wagmi's `useCapabilities` returns. */
export type WalletCapabilitiesRecord = Record<number, WalletCapabilities>;

/** Params for {@link useCapabilities}: the external EIP-5792 `walletProvider` to probe, the `chainId` to query, and the connected `account`. */
export type UseCapabilitiesParams = ReadHookParams<
  WalletCapabilitiesRecord,
  {
    walletProvider?: IGaslessCapableEvmWalletProvider;
    chainId?: number;
    /** Key-only, so a same-provider account switch refetches instead of serving stale caps (`walletProvider` isn't serializable). */
    account?: string;
  }
>;

/**
 * React hook mirroring wagmi's `useCapabilities`: probes an external EIP-5792 wallet's
 * `wallet_getCapabilities` for a chain and returns them keyed by chain id. Unlike wagmi it
 * takes the wallet by param (dapp-kit stays wallet-agnostic) and reads a single `chainId`.
 */
export function useCapabilities({
  params,
  queryOptions,
}: UseCapabilitiesParams = {}): UseQueryResult<WalletCapabilitiesRecord, Error> {
  const walletProvider = params?.walletProvider;
  const chainId = params?.chainId;
  const account = params?.account;

  return useQuery<WalletCapabilitiesRecord, Error>({
    queryKey: ['externalWallets', 'capabilities', chainId, account],
    queryFn: async () => {
      if (!walletProvider || chainId == null) throw new Error('walletProvider and chainId are required');
      // `getCapabilities` returns an opaque EIP-5792 map; give it a typed view for the fields we read.
      const capabilities = (await walletProvider.getCapabilities(chainId)) as WalletCapabilities;
      return { [chainId]: capabilities };
    },
    enabled: walletProvider != null && chainId != null,
    ...queryOptions,
  });
}
