/**
 * Wiring test for hub/Sonic RPC failover (issue #225).
 *
 * Proves the config -> helper -> viem client path end to end without any RPC call: a `new Sodax(...)`
 * with multi-endpoint hub/Sonic config produces `fallback()` clients with the expected endpoint count,
 * and the default (no `rpcUrls`) stays a single-endpoint fallback (backward compatible). The hub chain
 * is read by two clients — `hubProvider.publicClient` (from `hub.rpcUrls`) and `spoke.sonic.publicClient`
 * (from `chains.sonic.rpcUrls`) — so both are asserted independently.
 */
import { describe, expect, it } from 'vitest';
import { ChainKeys } from '@sodax/types';
import { Sodax } from './Sodax.js';

const A = 'https://a.example';
const B = 'https://b.example';
const C = 'https://c.example';

describe('Sodax hub RPC failover wiring', () => {
  it('builds a multi-endpoint fallback hub client from hub.rpcUrls', () => {
    const sodax = new Sodax({ hub: { rpcUrls: [A, B] } });
    const transport = sodax.hubProvider.publicClient.transport;
    expect(transport.type).toBe('fallback');
    expect(transport.transports).toHaveLength(2);
  });

  it('builds a multi-endpoint fallback Sonic spoke client from chains.sonic.rpcUrls', () => {
    const sodax = new Sodax({ chains: { [ChainKeys.SONIC_MAINNET]: { rpcUrls: [A, B, C] } } });
    const transport = sodax.spoke.sonic.publicClient.transport;
    expect(transport.type).toBe('fallback');
    expect(transport.transports).toHaveLength(3);
  });

  it('defaults to a single-endpoint fallback when rpcUrls is unset (backward compatible)', () => {
    const sodax = new Sodax();
    expect(sodax.hubProvider.publicClient.transport.transports).toHaveLength(1);
    expect(sodax.spoke.sonic.publicClient.transport.transports).toHaveLength(1);
  });
});
