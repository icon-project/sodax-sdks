import { type ChainKey, ChainKeys, spokeChainConfig } from '@sodax/dapp-kit';
import type { PlaygroundChainKey } from './lib/chains';

const env = import.meta.env as Record<string, string | undefined>;

// Per-chain RPC override keyed by the ChainKeys constant name (VITE_RPC_BASE_MAINNET). Defaults come
// from @sodax/types, so this app never carries an endpoint list of its own.
const rpcOverrides: Partial<Record<ChainKey, string>> = Object.fromEntries(
  Object.entries(ChainKeys).map(([name, key]) => [key, env[`VITE_RPC_${name}`]]),
);

export function rpcUrl(key: PlaygroundChainKey): string {
  return rpcOverrides[key] ?? spokeChainConfig[key].rpcUrl;
}

/** `quote-only` hides every signing path, so an embed of this page cannot spend real funds. */
export const playgroundMode = env.VITE_PLAYGROUND_MODE === 'quote-only' ? 'quote-only' : 'full';

export const walletConnectProjectId = env.VITE_WALLETCONNECT_PROJECT_ID;

export const DEFAULT_SLIPPAGE_PERCENT = '0.5';

/** address(0) = any admitted solver may fill. This never pins a specific solver. */
export const ANY_SOLVER = '0x0000000000000000000000000000000000000000' as const;
