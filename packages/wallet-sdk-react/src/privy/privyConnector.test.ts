import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress, numberToHex, SwitchChainError, UserRejectedRequestError } from 'viem';
import { base, mainnet, sonic } from 'viem/chains';
import { type Config, type Connector, createConfig, createConnector, createStorage, http } from 'wagmi';
import { connect, disconnect, getConnectorClient, reconnect, switchChain } from 'wagmi/actions';
import { INTERNAL_CALL_MS, PRIVY_CONNECTOR_ID, RECONNECT_BUDGET_MS } from './constants.js';
import { privyConnector } from './privyConnector.js';
import { createPrivyRuntime, type EmbeddedWallet, type PrivySnapshot } from './runtime.js';

// Real wagmi config + the real runtime, with the bridge simulated through `runtime.publish` — no Privy import.

const ADDRESS = '0x00000000000000000000000000000000000000aa';
const OTHER = '0x00000000000000000000000000000000000000bb';
const FLAG_KEY = 'sodax.privy.connected';

type SnapshotState = Omit<PrivySnapshot, 'mounted'>;
type RequestArgs = { method: string; params?: unknown };

const loggedOut: SnapshotState = {
  ready: true,
  authenticated: false,
  error: null,
  userLoaded: false,
  hasEmbeddedAccount: false,
  walletsReady: true,
  embedded: undefined,
};

const loggedIn = (embedded: EmbeddedWallet): SnapshotState => ({
  ready: true,
  authenticated: true,
  error: null,
  userLoaded: true,
  hasEmbeddedAccount: true,
  walletsReady: true,
  embedded,
});

function gate() {
  let open: () => void = () => undefined;
  const promise = new Promise<void>(resolve => {
    open = resolve;
  });
  return { promise, open };
}

type WalletOptions = {
  chainId?: number;
  ignoreSwitch?: boolean;
  signDelayMs?: number;
  /** `getEthereumProvider()` resolves only once this does. */
  providerGate?: Promise<void>;
  /** `wallet.switchChain()` resolves only once this does. */
  switchGate?: Promise<void>;
};

function fakeWallet(address = ADDRESS, options: WalletOptions = {}) {
  let chainId = options.chainId ?? sonic.id;
  const provider = {
    async request({ method, params }: RequestArgs): Promise<unknown> {
      if (method === 'eth_chainId') return numberToHex(chainId);
      if (method === 'wallet_switchEthereumChain') {
        const [{ chainId: hex }] = params as [{ chainId: string }]; // test double: params shape is ours
        if (!options.ignoreSwitch) chainId = Number(hex);
        return null;
      }
      if (method === 'eth_accounts') return [address];
      if (method === 'personal_sign') {
        await new Promise(resolve => setTimeout(resolve, options.signDelayMs ?? 0));
        return '0x5ig';
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  return {
    address,
    getEthereumProvider: vi.fn(async () => {
      await options.providerGate;
      return provider;
    }),
    switchChain: vi.fn(async () => {
      await options.switchGate;
    }),
  };
}

// Another wallet that is always authorized and answers locally (wagmi's `mock` reads accounts over RPC).
function otherWallet() {
  const provider = {};
  return createConnector(() => ({
    id: 'other',
    name: 'Other wallet',
    type: 'other',
    connect: async () => ({ accounts: [getAddress(OTHER)], chainId: sonic.id }),
    disconnect: async () => undefined,
    getAccounts: async () => [getAddress(OTHER)],
    getChainId: async () => sonic.id,
    getProvider: async () => provider,
    isAuthorized: async () => true,
    onAccountsChanged: () => undefined,
    onChainChanged: () => undefined,
    onDisconnect: () => undefined,
  }));
}

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

function setup({ storageKey = 'sodax' }: { storageKey?: string } = {}) {
  const runtime = createPrivyRuntime();
  const ops = { login: vi.fn(), logout: vi.fn(async () => undefined), createWallet: vi.fn(async () => undefined) };
  runtime.attach(ops);
  let config: Config | undefined;
  const getState = () => {
    if (!config) throw new Error('config not created');
    return config.state;
  };
  config = createConfig({
    chains: [sonic, base],
    connectors: [privyConnector({ runtime, getState, defaultChainId: sonic.id }), otherWallet()],
    multiInjectedProviderDiscovery: false,
    storage: createStorage({ key: storageKey, storage: memoryStorage() }),
    transports: { [sonic.id]: http(), [base.id]: http() },
  });
  const find = (id: string): Connector => {
    const found = config?.connectors.find(connector => connector.id === id);
    if (!found) throw new Error(`no ${id} connector`);
    return found;
  };
  return { runtime, ops, config, privy: find(PRIVY_CONNECTOR_ID), other: find('other') };
}

async function connected() {
  const context = setup();
  const wallet = fakeWallet();
  context.runtime.publish(loggedIn(wallet));
  await connect(context.config, { connector: context.privy });
  return { ...context, wallet };
}

async function request(connector: Connector, args: RequestArgs): Promise<unknown> {
  // test double: the Connector type erases the provider; ours is the DeferredProvider
  const provider = (await connector.getProvider()) as { request(args: RequestArgs): Promise<unknown> };
  return provider.request(args);
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('privyConnector — first login', () => {
  it('logs in through the modal and connects the embedded wallet on the requested chain', async () => {
    const { runtime, ops, config, privy } = setup();
    const wallet = fakeWallet();
    runtime.publish(loggedOut);
    ops.login.mockImplementation(() => {
      queueMicrotask(() => {
        runtime.publish(loggedIn(wallet));
        runtime.loginCompleted();
      });
    });

    const result = await connect(config, { connector: privy, chainId: base.id });

    expect(ops.login).toHaveBeenCalledOnce();
    expect(result).toEqual({ accounts: [getAddress(ADDRESS)], chainId: base.id });
    expect(await privy.getChainId()).toBe(base.id);
    expect(localStorage.getItem(FLAG_KEY)).toBe('1');
  });

  it('stays pending on recoverable in-modal errors and connects when login completes', async () => {
    const { runtime, ops, config, privy } = setup();
    runtime.publish(loggedOut);
    ops.login.mockImplementation(() => {
      queueMicrotask(() => {
        runtime.loginFailed('invalid_credentials');
        runtime.publish(loggedIn(fakeWallet()));
        runtime.loginCompleted();
      });
    });

    await expect(connect(config, { connector: privy })).resolves.toMatchObject({ chainId: sonic.id });
  });

  it('rejects as a user rejection only when the user closes the modal', async () => {
    const { runtime, ops, config, privy } = setup();
    runtime.publish(loggedOut);
    ops.login.mockImplementation(() => queueMicrotask(() => runtime.loginFailed('exited_auth_flow')));

    await expect(connect(config, { connector: privy })).rejects.toBeInstanceOf(UserRejectedRequestError);
    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
  });

  it('skips the modal for an already-authenticated user and creates a wallet only when none exists', async () => {
    const { runtime, ops, config, privy } = setup();
    const wallet = fakeWallet();
    runtime.publish({ ...loggedIn(wallet), hasEmbeddedAccount: false, embedded: undefined });
    ops.createWallet.mockImplementation(async () => {
      runtime.publish(loggedIn(wallet));
      return undefined;
    });

    await connect(config, { connector: privy });

    expect(ops.login).not.toHaveBeenCalled();
    expect(ops.createWallet).toHaveBeenCalledOnce();
  });

  it('surfaces Privy initialisation errors instead of waiting out a timeout', async () => {
    const { runtime, config, privy } = setup();
    const invalidAppId = new Error('missing_or_invalid_privy_app_id');
    runtime.publish({ ...loggedOut, ready: false, error: invalidAppId });

    await expect(connect(config, { connector: privy })).rejects.toBe(invalidAppId);
  });

  it('rejects at once with the cause when PrivyProvider could not start', async () => {
    const { runtime, config, privy } = setup();
    const httpsOnly = new Error('Embedded wallet is only available over HTTPS');
    runtime.fail(httpsOnly);

    await expect(connect(config, { connector: privy })).rejects.toBe(httpsOnly);
  });

  it('keys the connected flag by wagmi storage key (EVM.persistKey)', async () => {
    const { runtime, config, privy } = setup({ storageKey: 'partner' });
    runtime.publish(loggedIn(fakeWallet()));

    await connect(config, { connector: privy });

    expect(localStorage.getItem('partner.privy.connected')).toBe('1');
    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
  });
});

describe('privyConnector — reconnect', () => {
  it('never waits on Privy without the connected flag', async () => {
    const { runtime, config } = setup();
    const waitFor = vi.spyOn(runtime, 'waitFor');

    const connections = await reconnect(config);

    expect(waitFor).not.toHaveBeenCalled();
    expect(connections.map(c => c.connector.id)).toEqual(['other']);
  });

  it('restores from the localStorage flag alone (wagmi cookie storage lost on browser restart)', async () => {
    const { runtime, ops, config } = setup();
    localStorage.setItem(FLAG_KEY, '1');
    runtime.publish(loggedIn(fakeWallet()));

    const connections = await reconnect(config);

    expect(connections[0]?.connector.id).toBe(PRIVY_CONNECTOR_ID);
    expect(connections[0]?.accounts).toEqual([getAddress(ADDRESS)]);
    expect(ops.login).not.toHaveBeenCalled();
  });

  it('clears the flag without opening the modal when the Privy session has ended', async () => {
    const { runtime, ops, config } = setup();
    localStorage.setItem(FLAG_KEY, '1');
    runtime.publish(loggedOut);

    const connections = await reconnect(config);

    expect(connections.map(c => c.connector.id)).toEqual(['other']);
    expect(ops.login).not.toHaveBeenCalled();
    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
  });

  it('gives up on a Privy that never becomes ready within the budget, keeps the flag, and still restores other wallets', async () => {
    vi.useFakeTimers();
    const { config } = setup();
    localStorage.setItem(FLAG_KEY, '1');

    const pending = reconnect(config);
    await vi.advanceTimersByTimeAsync(RECONNECT_BUDGET_MS);
    const connections = await pending;

    expect(connections.map(c => c.connector.id)).toEqual(['other']);
    expect(localStorage.getItem(FLAG_KEY)).toBe('1');
  });

  it('bounds the whole restore, not only the ready wait, so other wallets are never held back longer', async () => {
    vi.useFakeTimers();
    const { runtime, config } = setup();
    localStorage.setItem(FLAG_KEY, '1');
    runtime.publish({ ...loggedIn(fakeWallet()), walletsReady: false, embedded: undefined });

    const pending = reconnect(config);
    await vi.advanceTimersByTimeAsync(RECONNECT_BUDGET_MS);
    const connections = await pending;

    expect(connections.map(c => c.connector.id)).toEqual(['other']);
    expect(localStorage.getItem(FLAG_KEY)).toBe('1');
  });

  it('never creates a wallet while restoring, and drops a flag whose user has none', async () => {
    const { runtime, ops, config } = setup();
    localStorage.setItem(FLAG_KEY, '1');
    runtime.publish({ ...loggedIn(fakeWallet()), hasEmbeddedAccount: false, embedded: undefined });

    const connections = await reconnect(config);

    expect(ops.createWallet).not.toHaveBeenCalled();
    expect(connections.map(c => c.connector.id)).toEqual(['other']);
    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
  });

  it('is not authorized when storage throws, and a failed read does not wedge later reconnects', async () => {
    const { privy, config } = setup();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(await privy.isAuthorized()).toBe(false);
    await reconnect(config);
    expect((await reconnect(config)).map(c => c.connector.id)).toEqual(['other']);
  });

  it('does not overwrite a wallet the user picked while Privy was still restoring', async () => {
    const { runtime, config, other } = setup();
    localStorage.setItem(FLAG_KEY, '1');
    const wallet = fakeWallet();
    runtime.publish({ ...loggedIn(wallet), walletsReady: false, embedded: undefined });

    const restoring = reconnect(config);
    await connect(config, { connector: other });
    runtime.publish(loggedIn(wallet));
    await restoring;

    expect(config.state.current).toBe(other.uid);
    expect([...config.state.connections.values()].map(c => c.connector.id)).not.toContain(PRIVY_CONNECTOR_ID);
    expect(localStorage.getItem(FLAG_KEY)).toBe('1');
  });

  it('keeps the live session when wagmi runs its reconnect again', async () => {
    const { runtime, config, privy } = setup();
    localStorage.setItem(FLAG_KEY, '1');
    const wallet = fakeWallet();
    runtime.publish(loggedIn(wallet));
    await reconnect(config);

    await reconnect(config);

    expect(wallet.getEthereumProvider).toHaveBeenCalledOnce();
    expect(config.state.status).toBe('connected');
    expect(await request(privy, { method: 'eth_chainId' })).toBe(numberToHex(sonic.id));
  });
});

describe('privyConnector — interactive supersession', () => {
  it('stands down when the user connects another wallet while the Privy login is open', async () => {
    const { runtime, ops, config, privy, other } = setup();
    runtime.publish(loggedOut);
    const loggingIn = connect(config, { connector: privy });
    await vi.waitFor(() => expect(ops.login).toHaveBeenCalled());

    await connect(config, { connector: other });
    runtime.publish(loggedIn(fakeWallet()));
    runtime.loginCompleted();

    await expect(loggingIn).rejects.toBeInstanceOf(UserRejectedRequestError);
    expect(config.state.current).toBe(other.uid);
    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
  });
});

describe('privyConnector — while connected', () => {
  it('disconnects and clears the flag when the Privy session ends elsewhere', async () => {
    const { runtime, config } = await connected();

    runtime.publish(loggedOut);

    expect(config.state.status).toBe('disconnected');
    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
  });

  it('disconnects rather than follow a different address', async () => {
    const { runtime, config } = await connected();

    runtime.publish(loggedIn(fakeWallet(OTHER)));

    expect(config.state.status).toBe('disconnected');
  });

  it('re-attaches quietly when Privy replaces the wallet object for the same address', async () => {
    const { runtime, config, privy } = await connected();
    const replacement = fakeWallet();
    const change = vi.fn();
    privy.emitter.on('change', change);

    runtime.publish(loggedIn(replacement));
    await vi.waitFor(() => expect(replacement.getEthereumProvider).toHaveBeenCalled());

    expect(config.state.status).toBe('connected');
    expect(change).not.toHaveBeenCalled();
  });

  it('ignores transient ticks while Privy reloads the user', async () => {
    const { runtime, config, wallet } = await connected();

    runtime.publish({ ...loggedIn(wallet), userLoaded: false, embedded: undefined });

    expect(config.state.status).toBe('connected');
  });

  it('switches chain in-band and reports the verified chain', async () => {
    const { config, privy, wallet } = await connected();

    await switchChain(config, { chainId: base.id });

    expect(await privy.getChainId()).toBe(base.id);
    expect(config.state.chainId).toBe(base.id);
    expect(wallet.switchChain).toHaveBeenCalledWith(base.id);
    await expect(getConnectorClient(config)).resolves.toMatchObject({ chain: { id: base.id } });
  });

  it('rejects a chain wagmi is not configured for', async () => {
    const { privy } = await connected();
    await expect(privy.switchChain?.({ chainId: mainnet.id })).rejects.toBeInstanceOf(SwitchChainError);
  });

  it('keeps the old chain when the wallet does not actually switch', async () => {
    const context = setup();
    context.runtime.publish(loggedIn(fakeWallet(ADDRESS, { ignoreSwitch: true })));
    await connect(context.config, { connector: context.privy });

    await expect(context.privy.switchChain?.({ chainId: base.id })).rejects.toBeInstanceOf(SwitchChainError);
    expect(await context.privy.getChainId()).toBe(sonic.id);
  });

  it('routes wallet_switchEthereumChain from the wallet client through the validated switch', async () => {
    const { privy } = await connected();

    await request(privy, { method: 'wallet_switchEthereumChain', params: [{ chainId: numberToHex(base.id) }] });

    expect(await privy.getChainId()).toBe(base.id);
    await expect(
      request(privy, { method: 'wallet_switchEthereumChain', params: [{ chainId: numberToHex(mainnet.id) }] }),
    ).rejects.toBeInstanceOf(SwitchChainError);
    await expect(request(privy, { method: 'wallet_switchEthereumChain', params: [] })).rejects.toThrow(/Invalid/);
  });

  it('ends the session once a switch settles when the logout arrived mid-switch', async () => {
    const context = setup();
    const switchGate = gate();
    const wallet = fakeWallet(ADDRESS, { switchGate: switchGate.promise });
    context.runtime.publish(loggedIn(wallet));
    await connect(context.config, { connector: context.privy });

    const switching = switchChain(context.config, { chainId: base.id });
    await vi.waitFor(() => expect(wallet.switchChain).toHaveBeenCalled());
    context.runtime.publish(loggedOut);
    expect(context.config.state.status).toBe('connected');
    switchGate.open();
    await switching;

    expect(context.config.state.status).toBe('disconnected');
    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
  });

  it('never times out a pass-through signing request (MFA or confirmation modal)', async () => {
    vi.useFakeTimers();
    const context = setup();
    context.runtime.publish(loggedIn(fakeWallet(ADDRESS, { signDelayMs: INTERNAL_CALL_MS * 3 })));
    const connecting = connect(context.config, { connector: context.privy });
    await vi.runAllTimersAsync();
    await connecting;

    const signing = request(context.privy, { method: 'personal_sign' });
    await vi.advanceTimersByTimeAsync(INTERNAL_CALL_MS * 3);

    await expect(signing).resolves.toBe('0x5ig');
  });

  it('keeps one provider object across logout and a new login', async () => {
    const { runtime, config, privy } = await connected();
    const before = await privy.getProvider();

    runtime.publish(loggedOut);
    runtime.publish(loggedIn(fakeWallet(OTHER)));
    await connect(config, { connector: privy });

    expect(await privy.getProvider()).toBe(before);
  });

  it('disconnect signs out of Privy and aborts a pending login', async () => {
    const context = setup();
    context.runtime.publish(loggedOut);
    const pending = connect(context.config, { connector: context.privy });
    await vi.waitFor(() => expect(context.ops.login).toHaveBeenCalled());

    await context.privy.disconnect();

    await expect(pending).rejects.toBeInstanceOf(UserRejectedRequestError);
    expect(context.ops.logout).toHaveBeenCalledOnce();
  });
});

describe('privyConnector — cancellation and teardown', () => {
  it('does not commit an attempt that was disconnected while the wallet provider was loading', async () => {
    const context = setup();
    const providerGate = gate();
    const wallet = fakeWallet(ADDRESS, { providerGate: providerGate.promise });
    context.runtime.publish(loggedIn(wallet));
    const connecting = connect(context.config, { connector: context.privy });
    await vi.waitFor(() => expect(wallet.getEthereumProvider).toHaveBeenCalled());

    await context.privy.disconnect();
    providerGate.open();

    await expect(connecting).rejects.toBeInstanceOf(UserRejectedRequestError);
    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
    expect(await context.privy.getAccounts()).toEqual([]);
  });

  it('does not commit an attempt that was disconnected while switching to the requested chain', async () => {
    const context = setup();
    const switchGate = gate();
    const wallet = fakeWallet(ADDRESS, { switchGate: switchGate.promise });
    context.runtime.publish(loggedIn(wallet));
    const connecting = connect(context.config, { connector: context.privy, chainId: base.id });
    await vi.waitFor(() => expect(wallet.switchChain).toHaveBeenCalled());

    await context.privy.disconnect();
    switchGate.open();

    await expect(connecting).rejects.toBeInstanceOf(UserRejectedRequestError);
    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
    expect(context.config.state.status).not.toBe('connected');
  });

  it('leaves no watcher behind from a superseded attempt', async () => {
    const context = setup();
    const providerGate = gate();
    const first = fakeWallet(ADDRESS, { providerGate: providerGate.promise });
    context.runtime.publish(loggedIn(first));
    const firstAttempt = context.privy.connect();
    await vi.waitFor(() => expect(first.getEthereumProvider).toHaveBeenCalled());

    context.runtime.publish(loggedIn(fakeWallet()));
    const secondAttempt = context.privy.connect();
    await expect(firstAttempt).rejects.toBeInstanceOf(UserRejectedRequestError);
    await secondAttempt;
    providerGate.open();
    await settle();

    const disconnects = vi.fn();
    context.privy.emitter.on('disconnect', disconnects);
    await context.privy.disconnect();
    context.runtime.publish(loggedOut);

    expect(disconnects).not.toHaveBeenCalled();
  });

  it('never re-attaches a provider that arrives after disconnect', async () => {
    const { runtime, privy } = await connected();
    const providerGate = gate();
    const replacement = fakeWallet(ADDRESS, { providerGate: providerGate.promise });
    runtime.publish(loggedIn(replacement));
    await vi.waitFor(() => expect(replacement.getEthereumProvider).toHaveBeenCalled());

    await privy.disconnect();
    providerGate.open();
    await settle();

    await expect(request(privy, { method: 'eth_chainId' })).rejects.toThrow(/not connected/);
  });

  it('does not keep the connection when the Privy sign-out stalls', async () => {
    vi.useFakeTimers();
    const context = setup();
    context.ops.logout.mockImplementation(() => new Promise<undefined>(() => undefined));
    context.runtime.publish(loggedIn(fakeWallet()));
    await connect(context.config, { connector: context.privy });

    const disconnecting = disconnect(context.config, { connector: context.privy });
    await vi.advanceTimersByTimeAsync(INTERNAL_CALL_MS);
    await disconnecting;

    expect(context.config.state.status).toBe('disconnected');
    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
  });
});
