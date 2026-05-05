import { describe, expect, it, vi } from 'vitest';
import type { ChainType } from '@sodax/types';
import type { IXConnector } from '@/types/interfaces.js';
import type { XConnection } from '@/types/index.js';
import {
  resolveDisconnectTargets,
  runBatchDisconnect,
  type BatchDisconnectProgressEvent,
} from './useBatchDisconnect.js';

const makeConnector = (chainType: ChainType, id: string, name = id): IXConnector =>
  ({
    xChainType: chainType,
    id,
    name,
    _id: id,
    isInstalled: true,
    installUrl: undefined,
    icon: undefined,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }) as unknown as IXConnector;

const connection = (chainType: ChainType, address: string, xConnectorId: string): XConnection => ({
  xAccount: { address, xChainType: chainType },
  xConnectorId,
});

// ─── resolveDisconnectTargets ───────────────────────────────────────────────

describe('resolveDisconnectTargets', () => {
  it('returns every connected chain when connectors filter is undefined', () => {
    const connections = {
      EVM: connection('EVM', '0xabc', 'io.hana.wallet'),
      ICON: connection('ICON', 'hx123', 'hana'),
    };
    expect(resolveDisconnectTargets(undefined, connections, {})).toEqual(['ICON', 'EVM']);
  });

  it('skips chains without an active address', () => {
    const connections = {
      EVM: { xAccount: { address: undefined, xChainType: 'EVM' as const }, xConnectorId: 'io.hana.wallet' },
      ICON: connection('ICON', 'hx123', 'hana'),
    };
    expect(resolveDisconnectTargets(undefined, connections, {})).toEqual(['ICON']);
  });

  it('filters by identifier match against the active connector', () => {
    const connections = {
      EVM: connection('EVM', '0xabc', 'io.hana.wallet'),
      ICON: connection('ICON', 'hx123', 'hana'),
      SOLANA: connection('SOLANA', 'sol-addr', 'phantom'),
    };
    const connectorsByChain = {
      EVM: [makeConnector('EVM', 'io.hana.wallet', 'Hana')],
      ICON: [makeConnector('ICON', 'hana', 'Hana')],
      SOLANA: [makeConnector('SOLANA', 'phantom', 'Phantom')],
    };

    expect(resolveDisconnectTargets(['hana'], connections, connectorsByChain)).toEqual(['ICON', 'EVM']);
  });

  it('skips connections whose connectorId does not match any registered connector', () => {
    const connections = { EVM: connection('EVM', '0xabc', 'unknown-connector') };
    const connectorsByChain = { EVM: [makeConnector('EVM', 'hana', 'Hana')] };

    expect(resolveDisconnectTargets(['hana'], connections, connectorsByChain)).toEqual([]);
  });

  it('returns empty when no chains are connected', () => {
    expect(resolveDisconnectTargets(undefined, {}, {})).toEqual([]);
  });

  it('multiple identifiers OR-match', () => {
    const connections = {
      EVM: connection('EVM', '0xabc', 'io.hana.wallet'),
      SOLANA: connection('SOLANA', 'sol-addr', 'phantom'),
    };
    const connectorsByChain = {
      EVM: [makeConnector('EVM', 'io.hana.wallet', 'Hana')],
      SOLANA: [makeConnector('SOLANA', 'phantom', 'Phantom')],
    };

    expect(resolveDisconnectTargets(['hana', 'phantom'], connections, connectorsByChain)).toEqual(['EVM', 'SOLANA']);
  });
});

// ─── runBatchDisconnect ─────────────────────────────────────────────────────

describe('runBatchDisconnect', () => {
  it('all-success path: every chain disconnects', async () => {
    const disconnect = vi.fn(async () => undefined);
    const result = await runBatchDisconnect(['EVM', 'ICON'], disconnect);

    expect(result).toEqual({ successful: ['EVM', 'ICON'], failed: [] });
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenNthCalledWith(1, { xChainType: 'EVM' });
    expect(disconnect).toHaveBeenNthCalledWith(2, { xChainType: 'ICON' });
  });

  it('collects failures without throwing', async () => {
    const evmError = new Error('extension closed');
    const disconnect = vi.fn(async ({ xChainType }: { xChainType: ChainType }) => {
      if (xChainType === 'EVM') throw evmError;
    });

    const result = await runBatchDisconnect(['EVM', 'ICON'], disconnect);

    expect(result.successful).toEqual(['ICON']);
    expect(result.failed).toEqual([{ chainType: 'EVM', error: evmError }]);
  });

  it('wraps non-Error throws into Error', async () => {
    const disconnect = vi.fn(async () => {
      throw 'string-error';
    });
    const result = await runBatchDisconnect(['EVM'], disconnect);

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.error).toBeInstanceOf(Error);
    expect(result.failed[0]?.error.message).toBe('string-error');
  });

  it('emits onProgress per target with correct outcomes', async () => {
    const events: BatchDisconnectProgressEvent[] = [];
    const evmError = new Error('failed');
    const disconnect = vi.fn(async ({ xChainType }: { xChainType: ChainType }) => {
      if (xChainType === 'EVM') throw evmError;
    });

    await runBatchDisconnect(['EVM', 'ICON'], disconnect, e => events.push(e));

    expect(events).toEqual([
      { chainType: 'EVM', outcome: 'failure', error: evmError },
      { chainType: 'ICON', outcome: 'success' },
    ]);
  });

  it('isolates throwing onProgress callback — batch still completes', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const disconnect = vi.fn(async () => undefined);

    const result = await runBatchDisconnect(['EVM'], disconnect, () => {
      throw new Error('progress threw');
    });

    expect(result.successful).toEqual(['EVM']);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('preserves sequential ordering of chainTypes', async () => {
    const callOrder: ChainType[] = [];
    const disconnect = vi.fn(async ({ xChainType }: { xChainType: ChainType }) => {
      callOrder.push(xChainType);
    });

    await runBatchDisconnect(['ICON', 'SOLANA', 'EVM'], disconnect);

    expect(callOrder).toEqual(['ICON', 'SOLANA', 'EVM']);
  });

  it('returns empty success/failed for empty input', async () => {
    const disconnect = vi.fn();
    const result = await runBatchDisconnect([], disconnect);
    expect(result).toEqual({ successful: [], failed: [] });
    expect(disconnect).not.toHaveBeenCalled();
  });
});
