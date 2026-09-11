import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted before the dynamic SUT import so the mock is in place when the module
// first evaluates. The connector imports `AddressPurpose` / `MessageSigningProtocols`
// statically and `request` via dynamic import — all resolve to this mock.
const request = vi.fn();

vi.mock('sats-connect', () => ({
  request,
  AddressPurpose: { Payment: 'payment', Ordinals: 'ordinals' },
  MessageSigningProtocols: { ECDSA: 'ECDSA', BIP322: 'BIP322' },
}));

const { BitcoinHanaXConnector } = await import('./BitcoinHanaXConnector.js');

const HANA_PROVIDER_ID = 'hanaWallet.bitcoin';

// The connector detects Hana via a local cast (it doesn't augment global `Window`),
// so the test casts too when planting/clearing the window surface.
type HanaWin = { hanaWallet?: { bitcoin?: unknown } };

/** Mark Hana as installed on the happy-dom window. */
function installHana(): void {
  (window as HanaWin).hanaWallet = { bitcoin: {} };
}

beforeEach(() => {
  request.mockReset();
  localStorage.clear();
});

afterEach(() => {
  // Unstub first: the SSR test stubs `window` to undefined, so clearing
  // `window.hanaWallet` must happen only after the real window is restored.
  vi.unstubAllGlobals();
  if (typeof window !== 'undefined') (window as HanaWin).hanaWallet = undefined;
});

describe('BitcoinHanaXConnector — constructor + getters', () => {
  it('exposes a Bitcoin-suffixed id distinct from the ICON Hana connector', () => {
    const c = new BitcoinHanaXConnector();
    expect(c.id).toBe('hana-bitcoin');
    expect(c.name).toBe('Hana Wallet');
    expect(c.xChainType).toBe('BITCOIN');
    expect(c.installUrl).toContain('chromewebstore.google.com');
    expect(c.icon).toMatch(/^https?:\/\//);
  });

  it('defaults to Taproot (Ordinals) purpose when no preference is stored', () => {
    const c = new BitcoinHanaXConnector();
    expect(c.addressPurpose).toBe('ordinals');
  });

  it('restores the persisted SegWit (Payment) preference', () => {
    localStorage.setItem('hana-address-type', 'segwit');
    const c = new BitcoinHanaXConnector();
    expect(c.addressPurpose).toBe('payment');
  });

  it('persists the purpose set via setAddressPurpose', () => {
    const c = new BitcoinHanaXConnector();
    c.setAddressPurpose('segwit');
    expect(c.addressPurpose).toBe('payment');
    expect(localStorage.getItem('hana-address-type')).toBe('segwit');
  });
});

describe('BitcoinHanaXConnector.isInstalled / isAvailable', () => {
  it('returns false under SSR (window undefined)', () => {
    vi.stubGlobal('window', undefined);
    expect(BitcoinHanaXConnector.isAvailable()).toBe(false);
  });

  it('returns false when window.hanaWallet.bitcoin is absent', () => {
    expect(new BitcoinHanaXConnector().isInstalled).toBe(false);
  });

  it('returns true when window.hanaWallet.bitcoin is present', () => {
    installHana();
    expect(new BitcoinHanaXConnector().isInstalled).toBe(true);
  });
});

describe('BitcoinHanaXConnector.connect', () => {
  it('throws when Hana is not installed', async () => {
    await expect(new BitcoinHanaXConnector().connect()).rejects.toThrow('Hana wallet is not installed');
  });

  it('returns the XAccount and pins the Hana provider id on getAccounts', async () => {
    installHana();
    request.mockResolvedValueOnce({
      status: 'success',
      result: [{ address: 'bc1ptaproot', publicKey: '02deadbeef', purpose: 'ordinals', addressType: 'p2tr' }],
    });

    const result = await new BitcoinHanaXConnector().connect();

    expect(result).toEqual({ address: 'bc1ptaproot', publicKey: '02deadbeef', xChainType: 'BITCOIN' });
    expect(request).toHaveBeenCalledWith(
      'getAccounts',
      { purposes: ['ordinals'], message: 'Connect to Sodax' },
      HANA_PROVIDER_ID,
    );
  });

  it('throws with the wallet error message when getAccounts fails', async () => {
    installHana();
    request.mockResolvedValueOnce({ status: 'error', error: { message: 'user rejected' } });
    await expect(new BitcoinHanaXConnector().connect()).rejects.toThrow('user rejected');
  });
});

describe('BitcoinHanaWalletProvider — every sats-connect call is pinned to Hana', () => {
  beforeEach(() => {
    installHana();
  });

  async function connectedProvider() {
    request.mockResolvedValueOnce({
      status: 'success',
      result: [{ address: 'bc1ptaproot', publicKey: '02deadbeef', purpose: 'ordinals', addressType: 'p2tr' }],
    });
    const connector = new BitcoinHanaXConnector();
    await connector.connect();
    const provider = connector.getWalletProvider();
    if (!provider) throw new Error('expected a wallet provider after connect');
    request.mockReset();
    return provider;
  }

  it('signEcdsaMessage routes to Hana', async () => {
    const provider = await connectedProvider();
    request.mockResolvedValueOnce({ status: 'success', result: { signature: 'sig-ecdsa' } });

    expect(await provider.signEcdsaMessage('hello')).toBe('sig-ecdsa');
    expect(request).toHaveBeenCalledWith(
      'signMessage',
      { address: 'bc1ptaproot', message: 'hello', protocol: 'ECDSA' },
      HANA_PROVIDER_ID,
    );
  });

  it('signBip322Message routes to Hana', async () => {
    const provider = await connectedProvider();
    request.mockResolvedValueOnce({ status: 'success', result: { signature: 'sig-bip322' } });

    expect(await provider.signBip322Message('hello')).toBe('sig-bip322');
    expect(request).toHaveBeenCalledWith(
      'signMessage',
      { address: 'bc1ptaproot', message: 'hello', protocol: 'BIP322' },
      HANA_PROVIDER_ID,
    );
  });

  it('signTransaction routes to Hana', async () => {
    const provider = await connectedProvider();
    request.mockResolvedValueOnce({ status: 'success', result: { psbt: 'c2lnbmVk' } });

    await provider.signTransaction('cHNidP8BAA==');
    expect(request).toHaveBeenCalledWith('signPsbt', expect.objectContaining({ broadcast: false }), HANA_PROVIDER_ID);
  });

  it('sendBitcoin routes to Hana', async () => {
    const provider = await connectedProvider();
    request.mockResolvedValueOnce({ status: 'success', result: { txid: 'tx-hash' } });

    expect(await provider.sendBitcoin('bc1qdest', 1000n)).toBe('tx-hash');
    expect(request).toHaveBeenCalledWith(
      'sendTransfer',
      { recipients: [{ address: 'bc1qdest', amount: 1000 }] },
      HANA_PROVIDER_ID,
    );
  });
});

describe('BitcoinHanaXConnector — lifecycle', () => {
  it('disconnect clears the wallet provider', async () => {
    installHana();
    request.mockResolvedValueOnce({
      status: 'success',
      result: [{ address: 'bc1ptaproot', publicKey: '02deadbeef', purpose: 'ordinals', addressType: 'p2tr' }],
    });
    const connector = new BitcoinHanaXConnector();
    await connector.connect();
    expect(connector.getWalletProvider()).toBeDefined();

    await connector.disconnect();
    expect(connector.getWalletProvider()).toBeUndefined();
  });

  it('recreateWalletProvider needs both address and publicKey', () => {
    const connector = new BitcoinHanaXConnector();
    expect(connector.recreateWalletProvider({ address: 'bc1ptaproot', xChainType: 'BITCOIN' })).toBeUndefined();
    expect(
      connector.recreateWalletProvider({ address: 'bc1ptaproot', publicKey: '02deadbeef', xChainType: 'BITCOIN' }),
    ).toBeDefined();
  });
});
