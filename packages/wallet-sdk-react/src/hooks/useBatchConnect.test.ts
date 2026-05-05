import { describe, expect, it, vi } from 'vitest';
import type { ChainType } from '@sodax/types';
import type { IXConnector } from '@/types/interfaces.js';
import type { XAccount } from '@/types/index.js';
import {
  resolveBatchTargets,
  runBatchConnect,
  type BatchConnectProgressEvent,
} from './useBatchConnect.js';

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

const account = (address: string, chainType: ChainType): XAccount => ({ address, xChainType: chainType });

// ─── resolveBatchTargets ────────────────────────────────────────────────────

describe('resolveBatchTargets', () => {
  it('returns one target per chain whose connector matches an identifier', () => {
    const evmHana = makeConnector('EVM', 'io.hana.wallet', 'Hana');
    const iconHana = makeConnector('ICON', 'hana', 'Hana');

    const targets = resolveBatchTargets(['hana'], { EVM: [evmHana], ICON: [iconHana] });

    expect(targets).toEqual([
      { chainType: 'ICON', connector: iconHana },
      { chainType: 'EVM', connector: evmHana },
    ]);
  });

  it('first matching identifier wins per chain', () => {
    const phantom = makeConnector('SOLANA', 'phantom', 'Phantom');
    const hana = makeConnector('SOLANA', 'hana', 'Hana');

    const targets = resolveBatchTargets(['hana', 'phantom'], { SOLANA: [hana, phantom] });

    expect(targets).toEqual([{ chainType: 'SOLANA', connector: hana }]);
  });

  it('skips chains with no connectors', () => {
    const evmHana = makeConnector('EVM', 'hana', 'Hana');
    const targets = resolveBatchTargets(['hana'], { EVM: [evmHana], ICON: [] });
    expect(targets).toEqual([{ chainType: 'EVM', connector: evmHana }]);
  });

  it('skips chains where no identifier matches', () => {
    const phantom = makeConnector('SOLANA', 'phantom', 'Phantom');
    const targets = resolveBatchTargets(['hana'], { SOLANA: [phantom] });
    expect(targets).toEqual([]);
  });

  it('returns empty for empty connectors array', () => {
    const evmHana = makeConnector('EVM', 'hana', 'Hana');
    expect(resolveBatchTargets([], { EVM: [evmHana] })).toEqual([]);
  });
});

// ─── runBatchConnect ────────────────────────────────────────────────────────

describe('runBatchConnect', () => {
  const evmHana = makeConnector('EVM', 'hana', 'Hana');
  const iconHana = makeConnector('ICON', 'hana', 'Hana');

  it('all-success path: every target connects', async () => {
    const connect = vi.fn(async (c: IXConnector) => account(`addr-${c.xChainType}`, c.xChainType));
    const result = await runBatchConnect(
      [
        { chainType: 'EVM', connector: evmHana },
        { chainType: 'ICON', connector: iconHana },
      ],
      { connect, isConnected: () => false, skipConnected: false },
    );

    expect(result).toEqual({ successful: ['EVM', 'ICON'], failed: [], skipped: [] });
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('collects failures without throwing', async () => {
    const evmError = new Error('user rejected');
    const connect = vi.fn(async (c: IXConnector) => {
      if (c.xChainType === 'EVM') throw evmError;
      return account('addr-icon', 'ICON');
    });

    const result = await runBatchConnect(
      [
        { chainType: 'EVM', connector: evmHana },
        { chainType: 'ICON', connector: iconHana },
      ],
      { connect, isConnected: () => false, skipConnected: false },
    );

    expect(result.successful).toEqual(['ICON']);
    expect(result.failed).toEqual([{ chainType: 'EVM', error: evmError }]);
    expect(result.skipped).toEqual([]);
  });

  it('wraps non-Error throws into Error', async () => {
    const connect = vi.fn(async () => {
      throw 'string-error';
    });
    const result = await runBatchConnect([{ chainType: 'EVM', connector: evmHana }], {
      connect,
      isConnected: () => false,
      skipConnected: false,
    });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.error).toBeInstanceOf(Error);
    expect(result.failed[0]?.error.message).toBe('string-error');
  });

  it('skips already-connected chains when skipConnected is on', async () => {
    const connect = vi.fn(async (c: IXConnector) => account(`addr-${c.xChainType}`, c.xChainType));
    const isConnected = (chain: ChainType) => chain === 'EVM';

    const result = await runBatchConnect(
      [
        { chainType: 'EVM', connector: evmHana },
        { chainType: 'ICON', connector: iconHana },
      ],
      { connect, isConnected, skipConnected: true },
    );

    expect(result.successful).toEqual(['ICON']);
    expect(result.skipped).toEqual(['EVM']);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(iconHana);
  });

  it('does not skip already-connected chains when skipConnected is off', async () => {
    const connect = vi.fn(async (c: IXConnector) => account(`addr-${c.xChainType}`, c.xChainType));
    const isConnected = () => true;

    const result = await runBatchConnect([{ chainType: 'EVM', connector: evmHana }], {
      connect,
      isConnected,
      skipConnected: false,
    });

    expect(result.successful).toEqual(['EVM']);
    expect(result.skipped).toEqual([]);
  });

  it('emits onProgress per target with correct outcomes', async () => {
    const events: BatchConnectProgressEvent[] = [];
    const evmError = new Error('rejected');
    const connect = vi.fn(async (c: IXConnector) => {
      if (c.xChainType === 'EVM') throw evmError;
      return account('addr-icon', 'ICON');
    });

    await runBatchConnect(
      [
        { chainType: 'EVM', connector: evmHana },
        { chainType: 'ICON', connector: iconHana },
      ],
      { connect, isConnected: () => false, skipConnected: false, onProgress: e => events.push(e) },
    );

    expect(events).toEqual([
      { chainType: 'EVM', outcome: 'failure', error: evmError },
      { chainType: 'ICON', outcome: 'success' },
    ]);
  });

  it('emits skipped event when skipConnected gates the target', async () => {
    const events: BatchConnectProgressEvent[] = [];
    await runBatchConnect([{ chainType: 'EVM', connector: evmHana }], {
      connect: vi.fn(),
      isConnected: () => true,
      skipConnected: true,
      onProgress: e => events.push(e),
    });
    expect(events).toEqual([{ chainType: 'EVM', outcome: 'skipped' }]);
  });

  it('isolates throwing onProgress callback — batch still completes', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const connect = vi.fn(async (c: IXConnector) => account('addr', c.xChainType));

    const result = await runBatchConnect([{ chainType: 'EVM', connector: evmHana }], {
      connect,
      isConnected: () => false,
      skipConnected: false,
      onProgress: () => {
        throw new Error('progress threw');
      },
    });

    expect(result.successful).toEqual(['EVM']);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('preserves sequential ordering of targets', async () => {
    const callOrder: ChainType[] = [];
    const connect = vi.fn(async (c: IXConnector) => {
      callOrder.push(c.xChainType);
      return account('addr', c.xChainType);
    });

    await runBatchConnect(
      [
        { chainType: 'ICON', connector: iconHana },
        { chainType: 'EVM', connector: evmHana },
      ],
      { connect, isConnected: () => false, skipConnected: false },
    );

    expect(callOrder).toEqual(['ICON', 'EVM']);
  });
});
