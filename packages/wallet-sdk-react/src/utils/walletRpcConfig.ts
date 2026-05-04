import { getEvmChainKeyByChainId, type ChainKey, type EvmChainKey } from '@sodax/types';
import type { EvmWalletDefaults } from '@sodax/wallet-sdk-core';
import type { ChainEntry, EvmChainEntry, WalletDefaultsByKey } from '@/types/config.js';

export type { ChainEntry, WalletDefaultsByKey };

/**
 * Extract `defaults` from a chain entry. Returns undefined when the entry is
 * missing, or for Stacks's preset-name string variant (no `defaults` slot).
 */
export function getEntryDefaults<K extends ChainKey>(
  entry: ChainEntry<K> | undefined,
): WalletDefaultsByKey<K> | undefined {
  if (!entry || typeof entry === 'string') return undefined;
  return (entry as { defaults?: WalletDefaultsByKey<K> }).defaults;
}

/**
 * Extract `rpcUrl` from a chain entry. Use for chains whose underlying factory
 * expects a bare URL string (EVM/Solana/Sui/Icon/Near). Returns undefined for
 * missing entries and for non-rpcUrl forms (Stacks preset name, object entries
 * lacking the field) — downstream falls back to a public default.
 */
export function getRpcUrl<K extends ChainKey>(entry: ChainEntry<K> | undefined): string | undefined {
  if (!entry || typeof entry === 'string') return undefined;
  return (entry as { rpcUrl?: string }).rpcUrl;
}

/**
 * Resolve EVM wallet provider defaults for the chain currently active on a
 * wagmi-supplied client. Used by `EvmHydrator` so the provider re-instantiates
 * with the right defaults when wagmi swaps clients on chain switch.
 *
 * `getEvmChainKeyByChainId` lives in `@sodax/types` (alongside `baseChainInfo`,
 * the data source); this helper composes it with the `SodaxWalletConfig.EVM.chains`
 * lookup, which is React-layer concern.
 */
export function resolveEvmDefaults(
  activeChainId: number | undefined,
  evmChains: Partial<Record<EvmChainKey, EvmChainEntry>> | undefined,
): EvmWalletDefaults | undefined {
  const key = getEvmChainKeyByChainId(activeChainId);
  if (!key || !evmChains) return undefined;
  return evmChains[key]?.defaults;
}
