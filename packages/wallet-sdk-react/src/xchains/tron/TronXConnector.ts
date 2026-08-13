import type { XAccount } from '@/types/index.js';
import { XConnector } from '@/core/index.js';
import type { TronWebLike } from '@sodax/wallet-sdk-core';

// Self-contained data URI (the TRON mark) — avoids cross-origin/CORS image fetches.
const TRONLINK_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23EF0027'/%3E%3Cpath d='M7 9l13 2.5 5 3.5-9 12L11 15z' fill='none' stroke='%23fff' stroke-width='1.3' stroke-linejoin='round'/%3E%3C/svg%3E";
const TRONLINK_INSTALL_URL = 'https://www.tronlink.org/';

/** Shape of the injected `window.tronLink` object (TronLink browser extension). */
interface TronLinkInjected {
  request: (args: { method: string }) => Promise<unknown>;
  tronWeb?: TronWebLike;
  ready?: boolean;
}

/**
 * Every injected object that might speak the TronLink API, best-first.
 *
 * `window.tronLink` is NOT exclusively TronLink: multi-chain wallets (e.g. MetaMask's Tron support)
 * squat the same global, and calling `tron_requestAccounts` on one that has no Tron account fails
 * with "Unable to find any account for 195" (SLIP-44 195 = Tron) and returns code 4001. So we
 * collect every candidate, prefer the one that self-identifies as TronLink, and let `connect()` fall
 * through the rest if the first cannot produce an account.
 */
function getTronCandidates(): TronLinkInjected[] {
  if (typeof window === 'undefined') return [];
  const w = window as unknown as {
    tronLink?: TronLinkInjected;
    tron?: TronLinkInjected;
    tronWeb?: TronWebLike;
  };
  const found = [w.tronLink, w.tron].filter((p): p is TronLinkInjected => p != null);
  // Legacy bare `window.tronWeb` (no request method) — usable only if already unlocked.
  if (w.tronWeb && !found.some(p => p.tronWeb === w.tronWeb)) {
    found.push({ request: undefined as never, tronWeb: w.tronWeb });
  }
  const isTronLink = (p: TronLinkInjected): boolean =>
    (p as { isTronLink?: boolean }).isTronLink === true ||
    (p.tronWeb as { isTronLink?: boolean } | undefined)?.isTronLink === true;
  // Genuine TronLink first, everything else after.
  return [...found.filter(isTronLink), ...found.filter(p => !isTronLink(p))];
}

function getTronLink(): TronLinkInjected | undefined {
  return getTronCandidates()[0];
}

/**
 * Locate TronLink's injected `tronWeb`: `window.tronLink.tronWeb` first, then `window.tron?.tronWeb`
 * (MetaMask's Tron), then the legacy bare `window.tronWeb` — but the bare form ONLY when
 * `window.tronLink` is present, so we never poke a `tronWeb` another multi-chain wallet shimmed
 * (which is what triggers e.g. Phantom's "Unable to find any account for 195").
 */
function getInjectedTronWeb(): TronWebLike | undefined {
  for (const p of getTronCandidates()) {
    if (p.tronWeb?.defaultAddress?.base58) return p.tronWeb; // prefer one with a live account
  }
  return getTronCandidates().find(p => p.tronWeb)?.tronWeb;
}

/**
 * TronLink populates `tronWeb.defaultAddress` asynchronously after `tron_requestAccounts` — a single
 * read right after the prompt returns `undefined`, so poll briefly for it.
 */
async function waitForTronAddress(provider: TronLinkInjected, timeoutMs = 4000): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const address = provider.tronWeb?.defaultAddress?.base58 || getInjectedTronWeb()?.defaultAddress?.base58;
    if (address) return address;
    if (Date.now() >= deadline) return undefined;
    await new Promise(r => setTimeout(r, 150));
  }
}

/**
 * TronLink connector. TronLink is window-injected (no React adapter), so this actively drives the
 * connection: `tron_requestAccounts` prompts the user, then the base58 address is read from the
 * injected `tronWeb`. The registry's `createWalletProvider` reads {@link getTronWeb} to build a
 * browser-mode `TronWalletProvider`.
 */
export class TronXConnector extends XConnector {
  constructor() {
    super('TRON', 'TronLink', 'TronLink');
  }

  async connect(): Promise<XAccount | undefined> {
    const candidates = getTronCandidates();
    if (candidates.length === 0) {
      throw new Error('TronLink is not installed. Install the extension and reload the page.');
    }

    // Already unlocked + authorized (e.g. reconnect after refresh) — no prompt needed.
    const existing = getInjectedTronWeb()?.defaultAddress?.base58;
    if (existing) return { address: existing, xChainType: this.xChainType };

    // Prompt each injected provider, then let the ADDRESS decide — never the reply code. A
    // multi-chain wallet squatting the global answers 4001 ("Unable to find any account for 195")
    // even while TronLink is unlocked next to it, and TronLink itself can answer a non-200 code yet
    // still expose the account. Treating a code as fatal is what made a working wallet look rejected.
    let lastReason = '';
    for (const provider of candidates) {
      if (typeof provider.request !== 'function') continue;
      const res = (await provider.request({ method: 'tron_requestAccounts' }).catch((e: unknown) => {
        lastReason = e instanceof Error ? e.message : String(e);
        return undefined;
      })) as { code?: number; message?: string } | undefined;
      if (res?.code != null && res.code !== 200) lastReason = res.message ?? `code ${res.code}`;

      const address = await waitForTronAddress(provider, 1500);
      if (address) return { address, xChainType: this.xChainType };
    }

    // Every provider prompted: give the extension a final window to publish the account (approval
    // popups resolve out-of-band, so the address can land after the last request settles).
    const address = await waitForTronAddress(candidates[0] as TronLinkInjected, 3000);
    if (address) return { address, xChainType: this.xChainType };

    throw new Error(
      `Could not connect a Tron account${lastReason ? ` (${lastReason})` : ''}. Approve the TronLink popup, or open TronLink → Settings → Connected Sites and allow ${typeof location !== 'undefined' ? location.host : 'this site'}, then retry.`,
    );
  }

  async disconnect(): Promise<void> {
    // TronLink has no programmatic disconnect; clearing the app-side connection is enough.
  }

  public override get icon(): string {
    return TRONLINK_ICON;
  }

  public override get isInstalled(): boolean {
    // Only probe `window.tronLink` (a plain injected object) — NOT `tronWeb`. Reading `tronWeb` on the
    // render path can make TronLink initialize and emit "Unable to find any account for 195" when the
    // site isn't authorized yet. All current TronLink builds inject `window.tronLink`.
    return getTronLink() !== undefined;
  }

  public override get installUrl(): string | undefined {
    return TRONLINK_INSTALL_URL;
  }

  /** The injected TronWeb, for the registry to build a `TronWalletProvider` in browser mode. */
  public getTronWeb(): TronWebLike | undefined {
    return getInjectedTronWeb();
  }
}
