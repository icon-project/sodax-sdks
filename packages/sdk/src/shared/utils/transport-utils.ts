import { type Transport, fallback, http } from 'viem';
import type { RpcFailoverConfig } from '@sodax/types';

/** Config slice carrying a primary RPC URL plus the optional `rpcUrls`/`rpcOptions` failover fields. */
export type EvmRpcConfig = { rpcUrl: string } & RpcFailoverConfig;

/**
 * Builds a viem `fallback()` transport from an EVM RPC config. `rpcUrls` supersedes the single
 * `rpcUrl` only when it carries a usable (non-blank) entry — a blank or empty list (e.g. unset env
 * vars) must never suppress a healthy `rpcUrl`, and the transport is never built empty. Endpoints are
 * deduped (order preserved, primary first); a single endpoint still yields a `fallback` transport so
 * callers get a uniform type.
 */
export function buildEvmRpcTransport(cfg: EvmRpcConfig): Transport {
  const configured = (cfg.rpcUrls ?? []).filter(url => url.length > 0);
  const urls = [...new Set(configured.length > 0 ? configured : [cfg.rpcUrl])];
  // `rank` latency-ranks endpoints via a perpetual background poll; that is pointless (and a dangling
  // timer) with a single endpoint, so only honor it when more than one endpoint survives.
  const rpcOptions = cfg.rpcOptions?.rank && urls.length < 2 ? { ...cfg.rpcOptions, rank: false } : cfg.rpcOptions;
  return fallback(
    urls.map(url => http(url)),
    rpcOptions,
  );
}
