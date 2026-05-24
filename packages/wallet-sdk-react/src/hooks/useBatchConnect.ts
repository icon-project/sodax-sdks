import { useCallback, useRef, useState } from 'react';
import { ChainTypeArr, type ChainType } from '@sodax/types';
import type { XAccount } from '@/types/index.js';
import type { IXConnector } from '@/types/interfaces.js';
import { assert } from '@/shared/guards.js';
import { matchesConnectorIdentifier } from '@/utils/matchConnectorIdentifier.js';
import { useXConnect } from './useXConnect.js';
import { useXConnections } from './useXConnections.js';
import { useXConnectorsByChain } from './useXConnectorsByChain.js';
import type { BatchOperationStatus } from '@/types/batchStatus.js';

/**
 * Per-target event emitted by `onProgress` as the batch advances. Lets consumers
 * render a live "EVM: connecting… done; ICON: skipped; SUI: connecting…" log
 * instead of waiting for the final `run()` promise.
 */
export type BatchConnectProgressEvent =
  | { chainType: ChainType; outcome: 'success' }
  | { chainType: ChainType; outcome: 'failure'; error: Error }
  | { chainType: ChainType; outcome: 'skipped' };

export type BatchConnectResult = {
  /** Chain types where the connect attempt succeeded. */
  successful: ChainType[];
  /** Chain types where the connect attempt threw, paired with the raw error. */
  failed: Array<{ chainType: ChainType; error: Error }>;
  /** Chain types skipped because `{ skipConnected: true }` and an account was already present. */
  skipped: ChainType[];
};

export type UseBatchConnectOptions = {
  /**
   * Wallet brand identifiers (e.g. `'hana'`, `'phantom'`). Matched via
   * case-insensitive substring against `connector.id` and `connector.name` —
   * see {@link matchesConnectorIdentifier}.
   *
   * Resolution is **per-chain priority with fallback-on-failure**: for each
   * chain, every matching connector is queued in identifier order. The runner
   * tries them sequentially and stops at the first one that connects. If an
   * earlier identifier's connector fails (popup denied, extension error, …),
   * the next identifier's connector is tried. Subsequent identifiers are
   * silently skipped once a chain succeeds — only one popup per chain on the
   * happy path.
   *
   * To target a specific connector (not a brand), use
   * `useXConnectors(chainType).find(c => c.id === '...')` directly instead of
   * this API.
   *
   * @example ['hana']             // Hana across every chain it supports
   * @example ['hana', 'phantom']  // prefer Hana per chain; if Hana fails or
   *                                // is unavailable on a chain, fall back to
   *                                // Phantom (e.g. Solana).
   */
  connectors: readonly string[];
  /** Skip chains whose account is already connected at `run()` time. */
  skipConnected?: boolean;
  /**
   * Fires once per target as the batch progresses. Useful for live progress UI
   * (a spinner-per-chain list). Errors thrown from `onProgress` are caught and
   * logged — they do NOT fail the batch.
   */
  onProgress?: (event: BatchConnectProgressEvent) => void;
};

export type UseBatchConnectResult = {
  run: () => Promise<BatchConnectResult>;
  status: BatchOperationStatus;
  result: BatchConnectResult | null;
  /**
   * Clears `status` and `result`. Calling `reset()` while `status === 'running'`
   * only clears the observable state — the in-flight batch is NOT aborted
   * (there is no cancellation signal). When the batch eventually resolves,
   * `status` flips to `'done'` and `result` populates again. Typical usage
   * is to call `reset()` only after `status === 'done'`.
   */
  reset: () => void;
};

type BatchConnectTarget = {
  chainType: ChainType;
  connector: IXConnector;
};

/**
 * Pure helper — resolves user-supplied wallet identifiers to concrete
 * `{ chainType, connector }` targets across every chain the wallet is
 * available on. Emits **every matching connector per chain** in identifier
 * order — the runner uses the order as priority and only attempts later
 * targets for a chain when earlier ones fail. Extracted for testability
 * without mounting React.
 */
export function resolveBatchTargets(
  connectors: readonly string[],
  connectorsByChain: Partial<Record<ChainType, IXConnector[]>>,
): BatchConnectTarget[] {
  const targets: BatchConnectTarget[] = [];
  for (const chainType of ChainTypeArr) {
    const chainConnectors = connectorsByChain[chainType];
    if (!chainConnectors?.length) continue;
    for (const identifier of connectors) {
      const match = chainConnectors.find(c => matchesConnectorIdentifier(c, identifier));
      if (match) targets.push({ chainType, connector: match });
    }
  }
  return targets;
}

/**
 * Pure helper — runs the batch sequentially over resolved `targets`. The
 * resolver may emit multiple targets per chain (one per matching identifier);
 * this runner uses priority order with fallback-on-failure:
 *
 * - Once a chain succeeds (or is skipped via `skipConnected`), any remaining
 *   targets for that chain are silently dropped — only one popup per chain on
 *   the happy path.
 * - If the first target for a chain throws, the next target for the same
 *   chain is attempted. `result.failed` is populated only when every target
 *   for a chain has been exhausted without success.
 * - `onProgress` fires per-attempt (so the consumer can render a live
 *   "EVM: Hana failed, trying Phantom…" log). A chain may emit a `failure`
 *   event followed by a `success` event — the final outcome lives in
 *   `result`.
 *
 * Extracted for testability without mounting React.
 */
export async function runBatchConnect(
  targets: readonly BatchConnectTarget[],
  helpers: {
    connect: (connector: IXConnector) => Promise<XAccount | undefined>;
    isConnected: (chainType: ChainType) => boolean;
    skipConnected: boolean;
    onProgress?: (event: BatchConnectProgressEvent) => void;
  },
): Promise<BatchConnectResult> {
  const successful: ChainType[] = [];
  const failed: BatchConnectResult['failed'] = [];
  const skipped: ChainType[] = [];
  // Chain has been finalized this run — further targets for it are silently dropped.
  const finalized = new Set<ChainType>();
  // Most recent error per chain, retained until every target for that chain has been
  // tried. If a later target for the same chain succeeds, the entry is cleared.
  const pendingError = new Map<ChainType, Error>();

  const emit = (event: BatchConnectProgressEvent): void => {
    if (!helpers.onProgress) return;
    try {
      helpers.onProgress(event);
    } catch (err) {
      console.error('[useBatchConnect] onProgress threw:', err);
    }
  };

  for (const target of targets) {
    if (finalized.has(target.chainType)) continue;

    if (helpers.skipConnected && helpers.isConnected(target.chainType)) {
      skipped.push(target.chainType);
      finalized.add(target.chainType);
      emit({ chainType: target.chainType, outcome: 'skipped' });
      continue;
    }

    try {
      await helpers.connect(target.connector);
      successful.push(target.chainType);
      finalized.add(target.chainType);
      pendingError.delete(target.chainType);
      emit({ chainType: target.chainType, outcome: 'success' });
    } catch (raw) {
      const error = raw instanceof Error ? raw : new Error(String(raw));
      pendingError.set(target.chainType, error);
      emit({ chainType: target.chainType, outcome: 'failure', error });
      // NOT finalized — a later target for the same chain may still recover.
    }
  }

  // After every target has been visited, any chain still holding an error has
  // exhausted its fallback candidates.
  for (const [chainType, error] of pendingError) {
    if (!finalized.has(chainType)) failed.push({ chainType, error });
  }

  return { successful, failed, skipped };
}

/**
 * Connect every chain where one of the supplied wallet identifiers matches
 * an available connector. Sequential (safe for extensions that share popup
 * singletons); errors never throw from `run()` — failures are collected into
 * `result.failed`.
 *
 * Replaces the apps/web-era per-wallet wrappers
 * (`useConnectAllWithHana`, `useConnectRestWithHana`): pass the wallet name(s)
 * and the hook discovers all compatible chains from the registry.
 *
 * @example
 * // Connect Hana on every chain it supports (EVM, ICON, Solana, Sui, Stellar...)
 * const { run, status, result } = useBatchConnect({ connectors: ['hana'] });
 * await run();
 *
 * @example
 * // Only connect chains not already connected
 * const { run } = useBatchConnect({ connectors: ['hana'], skipConnected: true });
 * await run();
 */
export function useBatchConnect({
  connectors,
  skipConnected = false,
  onProgress,
}: UseBatchConnectOptions): UseBatchConnectResult {
  assert(Array.isArray(connectors), 'useBatchConnect: connectors must be an array');
  const { mutateAsync: connect } = useXConnect();
  const xConnectorsByChain = useXConnectorsByChain();
  const xConnections = useXConnections();

  const [status, setStatus] = useState<BatchOperationStatus>('idle');
  const [result, setResult] = useState<BatchConnectResult | null>(null);
  const inFlightRef = useRef<Promise<BatchConnectResult> | null>(null);

  // Keep `onProgress` in a ref so `run` doesn't need to list it as a dep —
  // consumers typically pass an inline function (new ref every render) and
  // rebuilding `run` each render would invalidate downstream `useEffect` deps.
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  const run = useCallback(async (): Promise<BatchConnectResult> => {
    // Concurrent-run guard — extensions share popup singletons, so a second
    // batch while one is in flight would race the first. Return the existing
    // promise so callers that double-click still get a result.
    if (inFlightRef.current) return inFlightRef.current;

    const batchPromise = (async () => {
      setStatus('running');
      const targets = resolveBatchTargets(connectors, xConnectorsByChain);
      const finalResult = await runBatchConnect(targets, {
        connect,
        isConnected: chainType => !!xConnections[chainType]?.xAccount.address,
        skipConnected,
        onProgress: event => onProgressRef.current?.(event),
      });
      setResult(finalResult);
      setStatus('done');
      return finalResult;
    })();

    inFlightRef.current = batchPromise;
    try {
      return await batchPromise;
    } finally {
      inFlightRef.current = null;
    }
  }, [connect, connectors, xConnectorsByChain, xConnections, skipConnected]);

  const reset = useCallback(() => {
    setStatus('idle');
    setResult(null);
  }, []);

  return { run, status, result, reset };
}
