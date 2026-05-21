import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the bundled libs subpath the SUT imports — same pattern as
// StacksWalletProvider.test.ts. Hoisted before the dynamic SUT import so
// the mock is in place when the module first evaluates.
const request = vi.fn();
const disconnect = vi.fn();

vi.mock('@sodax/libs/stacks/connect', () => ({ request, disconnect }));

const { StacksXConnector } = await import('./StacksXConnector.js');

const CONFIG = {
  id: 'LeatherProvider',
  name: 'Leather',
  icon: 'leather.svg',
  installUrl: 'https://leather.io/install',
};

afterEach(() => {
  // Clean up any `window.*` we set during the test so neighbouring tests start clean.
  for (const key of ['LeatherProvider', 'XverseProviders']) {
    if (key in globalThis) {
      delete (globalThis as Record<string, unknown>)[key];
    }
  }
  vi.unstubAllGlobals();
});

describe('StacksXConnector — constructor + getters', () => {
  it('exposes the config-driven id / name / icon / installUrl', () => {
    const c = new StacksXConnector(CONFIG);
    expect(c.id).toBe('LeatherProvider');
    expect(c.name).toBe('Leather');
    expect(c.icon).toBe('leather.svg');
    expect(c.installUrl).toBe('https://leather.io/install');
    expect(c.xChainType).toBe('STACKS');
  });
});

describe('StacksXConnector.isInstalled — SSR + browser', () => {
  it('returns false when `window` is undefined (SSR / Node server component)', () => {
    vi.stubGlobal('window', undefined);
    const c = new StacksXConnector(CONFIG);
    expect(c.isInstalled).toBe(false);
  });

  it('returns false when the provider id is not present on window', () => {
    vi.stubGlobal('window', {});
    const c = new StacksXConnector(CONFIG);
    expect(c.isInstalled).toBe(false);
  });

  it('returns true when the dot-separated id resolves to a non-undefined object', () => {
    // Leather injects window.LeatherProvider; Xverse uses a nested path
    // (window.XverseProviders.StacksProvider). Test both shapes.
    vi.stubGlobal('window', { LeatherProvider: { fake: true } });
    expect(new StacksXConnector(CONFIG).isInstalled).toBe(true);

    vi.stubGlobal('window', {
      XverseProviders: { StacksProvider: { fake: true } },
    });
    expect(
      new StacksXConnector({
        id: 'XverseProviders.StacksProvider',
        name: 'Xverse',
        icon: 'xverse.svg',
      }).isInstalled,
    ).toBe(true);
  });

  it('returns false when an intermediate object on the dot path is missing', () => {
    // The dot-walk should bail out cleanly, not crash.
    vi.stubGlobal('window', { XverseProviders: undefined });
    expect(
      new StacksXConnector({
        id: 'XverseProviders.StacksProvider',
        name: 'Xverse',
        icon: 'xverse.svg',
      }).isInstalled,
    ).toBe(false);
  });
});

describe('StacksXConnector.getProvider — window dot-walk', () => {
  it('returns undefined under SSR (typeof window === undefined)', () => {
    vi.stubGlobal('window', undefined);
    const c = new StacksXConnector(CONFIG);
    expect(c.getProvider()).toBeUndefined();
  });

  it('returns the provider object when the dot path resolves', () => {
    const fake = { reqHandler: () => undefined };
    vi.stubGlobal('window', { LeatherProvider: fake });
    const c = new StacksXConnector(CONFIG);
    expect(c.getProvider()).toBe(fake);
  });

  it('returns undefined when an intermediate object is missing from window', () => {
    vi.stubGlobal('window', { XverseProviders: undefined });
    const c = new StacksXConnector({
      id: 'XverseProviders.StacksProvider',
      name: 'Xverse',
      icon: 'xverse.svg',
    });
    expect(c.getProvider()).toBeUndefined();
  });
});

describe('StacksXConnector.connect', () => {
  beforeEach(() => {
    request.mockReset();
  });

  it('throws a meaningful error when the extension is not installed', async () => {
    vi.stubGlobal('window', {});
    const c = new StacksXConnector(CONFIG);

    await expect(c.connect()).rejects.toThrow(
      'Leather is not installed. Install the extension and reload the page.',
    );
  });

  it('returns the XAccount when stx_getAddresses yields an entry with purpose="stacks"', async () => {
    vi.stubGlobal('window', { LeatherProvider: { fake: true } });
    request.mockResolvedValueOnce({
      addresses: [
        { address: 'bc1q...', purpose: 'payment' },
        { address: 'SP1USERSTACKS', purpose: 'stacks' },
      ],
    });

    const result = await new StacksXConnector(CONFIG).connect();

    expect(result).toEqual({ address: 'SP1USERSTACKS', xChainType: 'STACKS' });
    // `request` should be called with the provider bound and the JSON-RPC method name.
    expect(request).toHaveBeenCalledWith({ provider: { fake: true } }, 'stx_getAddresses');
  });

  it('logs a warning and returns undefined when no entry has purpose="stacks"', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('window', { LeatherProvider: { fake: true } });
    request.mockResolvedValueOnce({
      addresses: [
        { address: 'bc1q...', purpose: 'payment' },
        { address: 'bc1p...', purpose: 'ordinals' },
      ],
    });

    const result = await new StacksXConnector(CONFIG).connect();

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[StacksXConnector] Leather: no address with purpose="stacks"'),
      expect.any(Array),
    );
    warnSpy.mockRestore();
  });
});

describe('StacksXConnector.disconnect', () => {
  it('delegates to the libs/stacks/connect `disconnect()` export', async () => {
    disconnect.mockClear();
    await new StacksXConnector(CONFIG).disconnect();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
