/**
 * Shared types (must not be circular dependencies! Import only from other packages in this project)
 * Forbidden to import types from other packages in this file!
 */

export type ByteArray = Uint8Array;
export type Base64String = string;
export type Hex = `0x${string}`;
export type Hash = `0x${string}`;
export type Address = `0x${string}`;
export type HubAddress = Address;
export type OriginalAssetAddress = string;
export type HttpUrl = `http://${string}` | `https://${string}`;

export type TxPollingConfig = {
  pollingIntervalMs: number;
  maxTimeoutMs: number;
};

/**
 * Tuning for the viem `fallback()` transport used when more than one RPC endpoint is configured.
 * Plain serializable mirror of viem's fallback options so this type stays dependency-free.
 */
export type RpcFallbackOptions = {
  /** Re-rank endpoints by latency instead of strict listed order (viem default: off; ignored unless more than one endpoint is configured). */
  rank?: boolean;
  /** Retries of the overall failover request before the error surfaces (viem default: 3); each attempt tries the endpoints in listed order. */
  retryCount?: number;
  /** Delay in ms between retries. */
  retryDelay?: number;
};

/**
 * Optional multi-endpoint RPC failover, mixed into EVM chain configs that support it.
 * When `rpcUrls` is present and non-empty it supersedes the single `rpcUrl` (first entry is primary);
 * an absent or empty `rpcUrls` preserves single-endpoint behavior.
 */
export type RpcFailoverConfig = {
  rpcUrls?: readonly string[];
  rpcOptions?: RpcFallbackOptions;
};
