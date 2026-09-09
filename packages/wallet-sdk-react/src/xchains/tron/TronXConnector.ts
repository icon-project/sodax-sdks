import type { XAccount } from '@/types/index.js';
import { XConnector } from '@/core/index.js';
import type { TronWebLike } from '@sodax/wallet-sdk-core';

// Self-contained data URI (the TRON mark) — avoids cross-origin/CORS image fetches.
const TRONLINK_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23EF0027'/%3E%3Cpath d='M7 9l13 2.5 5 3.5-9 12L11 15z' fill='none' stroke='%23fff' stroke-width='1.3' stroke-linejoin='round'/%3E%3C/svg%3E";
const TRONLINK_INSTALL_URL = 'https://www.tronlink.org/';

/** TIP-6963 discovery handshake, the Tron analogue of EIP-6963. */
const TIP6963_REQUEST = 'TIP6963:requestProvider';
const TIP6963_ANNOUNCE = 'TIP6963:announceProvider';

/** How long to let wallets answer the announce broadcast. Extensions reply near-immediately. */
const DISCOVERY_WINDOW_MS = 300;

/** EIP-1193 code for a user-rejected request. */
const USER_REJECTED = 4001;

/**
 * A Tron wallet provider. Authorization goes through `eth_requestAccounts`; the legacy
 * `tron_requestAccounts` is deprecated and answers a code instead of prompting.
 */
interface TronProvider {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  tronWeb?: TronWebLike;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

/** One TIP-6963 announcement: who the wallet is, plus its provider handle. */
interface Tip6963ProviderDetail {
  info?: { uuid?: string; name?: string; icon?: string; rdns?: string };
  provider: TronProvider;
}

type TronWindow = {
  tron?: TronProvider;
  tronLink?: TronProvider;
  tronWeb?: TronWebLike;
};

const tronWindow = (): TronWindow | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as TronWindow);

const isTronLinkDetail = (d: Tip6963ProviderDetail): boolean =>
  /tronlink/i.test(d.info?.name ?? '') || /tronlink/i.test(d.info?.rdns ?? '');

/**
 * Discover Tron providers via TIP-6963: broadcast a request, collect the announcements. Each wallet
 * identifies itself, so TronLink is picked rather than inferred from the shared globals.
 */
async function discoverProviders(timeoutMs = DISCOVERY_WINDOW_MS): Promise<Tip6963ProviderDetail[]> {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return [];

  const found: Tip6963ProviderDetail[] = [];
  const onAnnounce = (event: Event): void => {
    const detail = (event as CustomEvent<Tip6963ProviderDetail>).detail;
    if (detail?.provider && !found.some(d => d.provider === detail.provider)) found.push(detail);
  };

  window.addEventListener(TIP6963_ANNOUNCE, onAnnounce);
  window.dispatchEvent(new Event(TIP6963_REQUEST));
  await new Promise(resolve => setTimeout(resolve, timeoutMs));
  window.removeEventListener(TIP6963_ANNOUNCE, onAnnounce);

  // TronLink first; another announcing wallet is still usable when it is all that is present.
  return [...found.filter(isTronLinkDetail), ...found.filter(d => !isTronLinkDetail(d))];
}

/** The provider handle available without the async discovery round-trip. */
function syncProvider(): TronProvider | undefined {
  const w = tronWindow();
  return w?.tron ?? w?.tronLink;
}

/** The provider to authorize against: the TIP-6963 announcement first, then the injected globals. */
async function resolveProvider(): Promise<TronProvider | undefined> {
  const announced = await discoverProviders();
  return announced[0]?.provider ?? syncProvider();
}

/**
 * TronLink connector, built on TIP-6963 discovery. `connect()` authorizes against the announced
 * provider and reads its base58 address. The registry's `createWalletProvider` reads
 * {@link getTronWeb} to build a browser-mode `TronWalletProvider`.
 */
export class TronXConnector extends XConnector {
  /** Set by `connect()`, so the registry builds from the wallet that actually authorized. */
  private connected?: TronProvider;

  constructor() {
    super('TRON', 'TronLink', 'TronLink');
  }

  async connect(): Promise<XAccount | undefined> {
    const provider = await resolveProvider();
    if (!provider || typeof provider.request !== 'function') {
      throw new Error('TronLink is not installed. Install the extension and reload the page.');
    }

    let accounts: string[] | undefined;
    try {
      accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[] | undefined;
    } catch (error) {
      const { code, message } = (error ?? {}) as { code?: number; message?: string };
      if (code === USER_REJECTED) {
        throw new Error('Tron connection request was rejected in the wallet.');
      }
      throw new Error(`Could not connect a Tron account${message ? `: ${message}` : ''}.`);
    }

    // `accounts[0]` is the fallback because it is not guaranteed to be base58.
    const address = provider.tronWeb?.defaultAddress?.base58 || accounts?.[0];
    if (!address) {
      throw new Error('Tron wallet authorized but returned no account. Reload the page and retry.');
    }

    this.connected = provider;
    return { address, xChainType: this.xChainType };
  }

  async disconnect(): Promise<void> {
    // TronLink has no programmatic disconnect; clearing the app-side connection is enough.
    this.connected = undefined;
  }

  public override get icon(): string {
    return TRONLINK_ICON;
  }

  public override get isInstalled(): boolean {
    // Sync getter on the render path, so it cannot run TIP-6963 discovery, which is async.
    const w = tronWindow();
    return w?.tron != null || w?.tronLink != null;
  }

  public override get installUrl(): string | undefined {
    return TRONLINK_INSTALL_URL;
  }

  /** The authorized provider's TronWeb, for the registry to build a `TronWalletProvider`. */
  public getTronWeb(): TronWebLike | undefined {
    return this.connected?.tronWeb ?? syncProvider()?.tronWeb ?? tronWindow()?.tronWeb;
  }

  /** Subscribe to wallet-side account/network changes. Returns an unsubscribe function. */
  public onWalletEvents(handler: (event: 'accountsChanged' | 'chainChanged', payload: unknown) => void): () => void {
    const provider = this.connected ?? syncProvider();
    if (!provider?.on) return () => undefined;
    const onAccounts = (...args: unknown[]): void => handler('accountsChanged', args[0]);
    const onChain = (...args: unknown[]): void => handler('chainChanged', args[0]);
    provider.on('accountsChanged', onAccounts);
    provider.on('chainChanged', onChain);
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
    };
  }
}
