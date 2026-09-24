import { type Address, getAddress, numberToHex, SwitchChainError } from 'viem';
import { ChainNotConfiguredError, type Config, createConnector } from 'wagmi';
import { type ConnectedFlag, createConnectedFlag } from './connectedFlag.js';
import {
  INTERNAL_CALL_MS,
  PRIVY_CONNECTOR_ID,
  PRIVY_CONNECTOR_NAME,
  READY_CONNECT_MS,
  RECONNECT_BUDGET_MS,
  WALLET_MS,
} from './constants.js';
import { createDeferredProvider, type DeferredProvider, type Eip1193Like } from './deferredProvider.js';
import {
  PrivyConnectorSupersededError,
  PrivyTimeoutError,
  throwIfAborted,
  userRejected,
  withTimeout,
} from './errors.js';
import { PRIVY_ICON } from './icon.js';
import type { EmbeddedWallet, PrivyRuntime } from './runtime.js';

export type PrivyConnectorOptions = {
  runtime: PrivyRuntime;
  /** wagmi's live state, for the supersession check (`CreateConnectorFn` does not receive it). */
  getState: () => Config['state'];
  /** Chain reported before the first connection. */
  defaultChainId: number;
  /** `'detach'` keeps the Privy session on disconnect; see `PrivyOptions.disconnectBehavior`. @default 'logout' */
  disconnectBehavior?: 'logout' | 'detach';
  /** Test seam; defaults to a localStorage flag keyed by wagmi's storage key. */
  flag?: ConnectedFlag;
};

type Session = { readonly address: Address; readonly wallet: EmbeddedWallet };

/**
 * wagmi connector for the Privy embedded wallet. It never imports Privy: `PrivyBridge` feeds it through
 * `runtime`, and wagmi holds a stable deferred provider the embedded wallet is attached behind.
 */
export function privyConnector({
  runtime,
  getState,
  defaultChainId,
  disconnectBehavior = 'logout',
  flag: flagOverride,
}: PrivyConnectorOptions) {
  return createConnector<DeferredProvider>(config => {
    const flag = flagOverride ?? createConnectedFlag(`${config.storage?.key ?? 'sodax'}.privy.connected`);
    const deferred = createDeferredProvider(chainId => switchChain(chainId));
    let session: Session | undefined;
    let chainId: number | undefined; // last chain verified on the attached provider
    let attempt: AbortController | undefined;
    let attemptIsInteractive = false; // started by a user connect, not by wagmi's restore
    let generation = 0; // bumped on every detach, so late async work can tell it is stale
    let unwatch: (() => void) | undefined;
    let switching = false;

    const readChainId = async (provider: Eip1193Like, signal?: AbortSignal) =>
      Number(await withTimeout(provider.request({ method: 'eth_chainId' }), INTERNAL_CALL_MS, 'eth_chainId', signal));

    const requestSwitch = (provider: Eip1193Like, target: number, signal?: AbortSignal) =>
      withTimeout(
        provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: numberToHex(target) }] }),
        INTERNAL_CALL_MS,
        'wallet_switchEthereumChain',
        signal,
      );

    // No side effects: a provider from `getEthereumProvider()` starts on the chain Privy last recorded,
    // so it is pulled to `alignTo` before anyone can sign through it.
    async function prepare(wallet: EmbeddedWallet, alignTo: number | undefined, signal?: AbortSignal) {
      const provider = await withTimeout(wallet.getEthereumProvider(), INTERNAL_CALL_MS, 'getEthereumProvider', signal);
      let current = await readChainId(provider, signal);
      if (alignTo !== undefined && current !== alignTo) {
        await requestSwitch(provider, alignTo, signal);
        current = alignTo;
      }
      return { provider, chainId: current };
    }

    function detachSession() {
      generation += 1;
      unwatch?.();
      unwatch = undefined;
      deferred.detach();
      session = undefined;
    }

    function endSession() {
      detachSession();
      chainId = undefined;
      flag.clear();
      config.emitter.emit('disconnect');
    }

    // Privy's provider reports neither logout nor a user change, so the connector watches the runtime.
    function onRuntimeChange() {
      const current = session;
      const snapshot = runtime.getSnapshot();
      if (!current || !snapshot.mounted || switching) return;
      if (snapshot.ready && !snapshot.authenticated) return endSession();
      // Mid-reload: Privy is not ready, or the user's linked wallet is not listed yet.
      if (!snapshot.ready || !snapshot.userLoaded || (snapshot.hasEmbeddedAccount && !snapshot.embedded)) return;
      const wallet = snapshot.embedded;
      // Fail closed: never follow a different address for an intent-signing session.
      if (!wallet || getAddress(wallet.address) !== current.address) return endSession();
      if (wallet === current.wallet) return;
      const at = generation;
      session = { ...current, wallet };
      prepare(wallet, chainId).then(
        ({ provider }) => {
          if (at === generation) deferred.attach(provider);
        },
        () => {
          // Keep the previous attachment; it still signs for the same address.
        },
      );
    }

    function watch() {
      unwatch?.();
      unwatch = runtime.subscribe(onRuntimeChange);
    }

    async function switchChain(target: number) {
      const chain = config.chains.find(candidate => candidate.id === target);
      if (!chain) throw new SwitchChainError(new ChainNotConfiguredError());
      const provider = deferred.current();
      const current = session;
      if (!provider || !current) throw new SwitchChainError(new Error('The Privy wallet is not connected.'));
      switching = true;
      try {
        await requestSwitch(provider, target);
        // Best effort: keeps Privy's own per-wallet chain in step; `prepare` re-aligns a provider if it lags.
        await withTimeout(current.wallet.switchChain(target), INTERNAL_CALL_MS, 'switchChain').catch(() => undefined);
        const actual = await readChainId(provider);
        if (actual !== target) {
          throw new SwitchChainError(
            new Error(`The Privy wallet reports chain ${actual} after switching to ${target}.`),
          );
        }
        chainId = target;
        config.emitter.emit('change', { chainId: target });
        return chain;
      } finally {
        switching = false;
        if (unwatch) onRuntimeChange(); // a logout that arrived mid-switch
      }
    }

    return {
      id: PRIVY_CONNECTOR_ID,
      name: PRIVY_CONNECTOR_NAME,
      type: 'privy',
      icon: PRIVY_ICON,

      async connect({ chainId: requested, isReconnecting } = {}) {
        // Already attached (e.g. wagmi re-running its reconnect): report the live session, do not rebuild it.
        if (session && deferred.current()) {
          if (requested !== undefined && requested !== chainId) await switchChain(requested);
          return { accounts: [session.address], chainId: chainId ?? defaultChainId };
        }

        // A background restore stands down rather than cancel a connect the user started (its login may be open).
        if (isReconnecting && attempt && attemptIsInteractive) {
          throw new Error('[wallet-sdk-react/privy] A connection the user started is still in progress.');
        }
        attempt?.abort(userRejected('Superseded by a newer connection attempt.'));
        const controller = new AbortController();
        attempt = controller;
        attemptIsInteractive = !isReconnecting;
        const { signal } = controller;
        // wagmi restores wallets one after another: the whole restore gets one budget, not one per step.
        const budget = isReconnecting
          ? setTimeout(
              () => controller.abort(new PrivyTimeoutError('Restoring the Privy session', RECONNECT_BUDGET_MS)),
              RECONNECT_BUDGET_MS,
            )
          : undefined;
        const startCurrent = getState().current;

        try {
          const ready = await runtime.waitFor(s => s.ready, READY_CONNECT_MS, signal, 'Waiting for Privy to be ready');
          if (!ready.authenticated) {
            if (isReconnecting) {
              flag.clear();
              throw new Error('[wallet-sdk-react/privy] The Privy session has ended.');
            }
            await runtime.login(signal);
          }
          const user = await runtime.waitFor(
            s => s.authenticated && s.userLoaded,
            WALLET_MS,
            signal,
            'Waiting for the Privy user',
          );
          if (!user.hasEmbeddedAccount) {
            if (isReconnecting) {
              flag.clear();
              throw new Error('[wallet-sdk-react/privy] The Privy user has no embedded wallet.');
            }
            // Only on positive evidence: createWallet() throws for a user who already has one.
            await withTimeout(runtime.createWallet(), WALLET_MS, 'Creating the Privy wallet', signal).catch(
              () => undefined,
            );
          }
          const { embedded } = await runtime.waitFor(
            s => s.embedded !== undefined,
            WALLET_MS,
            signal,
            'Waiting for the Privy embedded wallet',
          );
          if (!embedded) throw new Error('[wallet-sdk-react/privy] No embedded wallet.');

          const prepared = await prepare(embedded, undefined, signal);
          throwIfAborted(signal);
          deferred.attach(prepared.provider);
          session = { address: getAddress(embedded.address), wallet: embedded };
          chainId = prepared.chainId;
          if (requested !== undefined && requested !== chainId) {
            await switchChain(requested);
            throwIfAborted(signal);
          }

          // No await from here to return. wagmi marks itself connecting before calling us, so `connected` here
          // means another wallet finished meanwhile — returning would make wagmi replace the user's choice.
          const { status, current, connections } = getState();
          const otherIsCurrent = current !== null && connections.get(current)?.connector.id !== PRIVY_CONNECTOR_ID;
          if (status === 'connected' && otherIsCurrent && (isReconnecting || current !== startCurrent)) {
            throw new PrivyConnectorSupersededError();
          }
          flag.write();
          watch();
          return { accounts: [session.address], chainId: chainId ?? defaultChainId };
        } catch (error) {
          if (attempt === controller) detachSession();
          throw error;
        } finally {
          clearTimeout(budget);
          if (attempt === controller) attempt = undefined;
        }
      },

      async disconnect() {
        attempt?.abort(userRejected('Disconnected while connecting.'));
        attempt = undefined;
        detachSession();
        chainId = undefined;
        flag.clear();
        if (disconnectBehavior === 'detach') return;
        // Bounded: wagmi drops the connection only once this resolves, and a stalled sign-out must not keep it.
        await withTimeout(runtime.logout(), INTERNAL_CALL_MS, 'logout').catch(() => undefined);
      },

      async getAccounts() {
        return session ? [session.address] : [];
      },

      async getChainId() {
        const provider = deferred.current();
        if (provider) {
          try {
            return await readChainId(provider);
          } catch {
            // Fall through to the last chain this connector verified.
          }
        }
        return chainId ?? defaultChainId;
      },

      async getProvider() {
        return deferred.provider;
      },

      async isAuthorized() {
        return flag.read();
      },

      async switchChain({ chainId: target }) {
        return switchChain(target);
      },

      onAccountsChanged(accounts) {
        if (accounts.length === 0) endSession();
      },

      onChainChanged(chain) {
        config.emitter.emit('change', { chainId: Number(chain) });
      },

      onDisconnect() {
        endSession();
      },
    };
  });
}
