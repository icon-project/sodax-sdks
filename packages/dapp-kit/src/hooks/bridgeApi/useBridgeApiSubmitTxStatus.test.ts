/**
 * A rejected API key is terminal, but this hook polls every second — so `retry` alone is not enough
 * to stop it. `retry` bounds attempts within one tick; without the `refetchInterval` guard the hook
 * would keep opening fresh ticks forever against a key that can never succeed.
 *
 * Follows the package convention of testing hooks without a renderer: the React Query wrapper is
 * mocked so the captured options can be driven directly.
 */

import { SodaxError } from '@sodax/sdk';
import { describe, expect, it, vi } from 'vitest';

// biome-ignore lint/suspicious/noExplicitAny: mirrors the real wrapper's opaque options bag.
let captured: any;

vi.mock('../shared/useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { api: { bridge: { getSubmitTxStatus: vi.fn() } } } }),
}));
vi.mock('@tanstack/react-query', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: mirrors the real wrapper's opaque options bag.
  useQuery: (options: any) => {
    captured = options;
    return {};
  },
}));

const { useBridgeApiSubmitTxStatus } = await import('./useBridgeApiSubmitTxStatus.js');

/** A bridge-API failure as the service surfaces it: `EXTERNAL_API_ERROR` with the status on context. */
const apiError = (status: number): SodaxError =>
  new SodaxError('EXTERNAL_API_ERROR', `responded with ${status}`, {
    feature: 'backend',
    context: { api: 'bridge', endpoint: '/bridge/submit-tx/status', status },
  });

/** One render, then the captured query options. */
// biome-ignore lint/suspicious/noExplicitAny: the captured options bag is untyped by design.
const render = (): any => {
  useBridgeApiSubmitTxStatus({ params: { txHash: '0xabc', srcChainKey: '0x38.bsc' } });
  return captured;
};

// biome-ignore lint/suspicious/noExplicitAny: a minimal stand-in for React Query's Query object.
const queryWith = (state: { error?: unknown; data?: unknown }): any => ({ state });

describe('useBridgeApiSubmitTxStatus retry policy', () => {
  it('never replays a terminal API-key rejection, even on the first failure', () => {
    const { retry } = render();
    expect(retry(0, apiError(401))).toBe(false);
    expect(retry(0, apiError(403))).toBe(false);
  });

  it('still replays a transient failure, up to the previous 3 attempts', () => {
    const { retry } = render();
    expect(retry(0, apiError(503))).toBe(true);
    expect(retry(2, apiError(500))).toBe(true);
    expect(retry(3, apiError(500))).toBe(false);
  });
});

describe('useBridgeApiSubmitTxStatus polling', () => {
  it('stops the 1s poll once the backend rejects the API key', () => {
    const { refetchInterval } = render();
    expect(refetchInterval(queryWith({ error: apiError(401) }))).toBe(false);
    expect(refetchInterval(queryWith({ error: apiError(403) }))).toBe(false);
  });

  it('keeps polling through a transient failure — only the key rejection is terminal', () => {
    const { refetchInterval } = render();
    expect(refetchInterval(queryWith({ error: apiError(503) }))).toBe(1000);
  });

  it('still stops on the terminal statuses and on abandonedAt', () => {
    const { refetchInterval } = render();
    expect(refetchInterval(queryWith({ data: { data: { status: 'executed' } } }))).toBe(false);
    expect(refetchInterval(queryWith({ data: { data: { status: 'failed' } } }))).toBe(false);
    expect(refetchInterval(queryWith({ data: { data: { status: 'relayed', abandonedAt: 1 } } }))).toBe(false);
  });

  it('keeps polling while the submission is still in flight', () => {
    const { refetchInterval } = render();
    expect(refetchInterval(queryWith({ data: { data: { status: 'relayed' } } }))).toBe(1000);
    expect(refetchInterval(queryWith({}))).toBe(1000);
  });
});
