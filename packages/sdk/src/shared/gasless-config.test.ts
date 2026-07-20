/**
 * Unit tests for `resolveGasless` endpoint resolution — focused on the `paymasterProxyUrl` option
 * (a backend ERC-7677 paymaster proxy that keeps the Pimlico key server-side for Mode A) and its
 * precedence against an explicit per-chain `paymasterUrl` and the `pimlicoApiKey` fallback.
 */

import { describe, expect, it } from 'vitest';
import type { EvmSpokeOnlyChainKey } from '@sodax/types';
import { resolveGasless } from './gasless-config.js';

const BSC = '0x38.bsc' satisfies EvmSpokeOnlyChainKey;
const CHAIN_ID = 56; // BSC; only used to shape the synthesized URLs.
const pimlicoUrl = (id: number, key: string) => `https://api.pimlico.io/v2/${id}/rpc?apikey=${key}`;

describe('resolveGasless — paymasterProxyUrl', () => {
  it('is Mode-A eligible with only { supports7702, paymasterProxyUrl } (no pimlicoApiKey), and provides no bundler', () => {
    const g = resolveGasless({ paymasterProxyUrl: 'https://proxy.test', chains: { [BSC]: { supports7702: true } } });
    expect(g.isSupported(BSC)).toBe(true);
    const ep = g.resolveEndpoints(BSC, CHAIN_ID);
    expect(ep?.paymasterUrl).toBe(`https://proxy.test/${CHAIN_ID}`);
    expect(ep?.bundlerUrl).toBeUndefined(); // proxy = paymaster only; Mode A uses the wallet's own bundler
    expect(ep?.paymasterIsPublic).toBe(true); // a proxy URL is safe to hand to a client
  });

  it('appends the chain id and strips a trailing slash on the proxy base', () => {
    const g = resolveGasless({ paymasterProxyUrl: 'https://proxy.test/', chains: { [BSC]: { supports7702: true } } });
    expect(g.resolveEndpoints(BSC, CHAIN_ID)?.paymasterUrl).toBe(`https://proxy.test/${CHAIN_ID}`);
  });

  it('precedence: an explicit per-chain paymasterUrl overrides both the proxy and pimlico', () => {
    const g = resolveGasless({
      pimlicoApiKey: 'KEY',
      paymasterProxyUrl: 'https://proxy.test',
      chains: { [BSC]: { supports7702: true, paymasterUrl: 'https://explicit.test/pm' } },
    });
    const ep = g.resolveEndpoints(BSC, CHAIN_ID);
    expect(ep?.paymasterUrl).toBe('https://explicit.test/pm');
    expect(ep?.paymasterIsPublic).toBe(true); // an operator-set explicit URL is treated as client-safe
  });

  it('hybrid: proxy supplies the Mode-A paymaster while pimlico still supplies the Mode-B bundler', () => {
    const g = resolveGasless({
      pimlicoApiKey: 'KEY',
      paymasterProxyUrl: 'https://proxy.test',
      chains: { [BSC]: { supports7702: true } },
    });
    const ep = g.resolveEndpoints(BSC, CHAIN_ID);
    expect(ep?.paymasterUrl).toBe(`https://proxy.test/${CHAIN_ID}`); // proxy wins for the paymaster
    expect(ep?.bundlerUrl).toBe(pimlicoUrl(CHAIN_ID, 'KEY')); // pimlico still fills the bundler
  });

  it('a chain without supports7702 is never eligible, even with a proxy configured', () => {
    const g = resolveGasless({ paymasterProxyUrl: 'https://proxy.test', chains: { [BSC]: { supports7702: false } } });
    expect(g.isSupported(BSC)).toBe(false);
    expect(g.resolveEndpoints(BSC, CHAIN_ID)).toBeUndefined();
  });

  it('direct mode (pimlicoApiKey only) is unchanged — both endpoints synthesized from the key', () => {
    const g = resolveGasless({ pimlicoApiKey: 'KEY', chains: { [BSC]: { supports7702: true } } });
    const ep = g.resolveEndpoints(BSC, CHAIN_ID);
    expect(ep?.paymasterUrl).toBe(pimlicoUrl(CHAIN_ID, 'KEY'));
    expect(ep?.bundlerUrl).toBe(pimlicoUrl(CHAIN_ID, 'KEY'));
    expect(ep?.paymasterIsPublic).toBe(false); // the key-bearing fallback must NOT be exposed to a client
  });
});
