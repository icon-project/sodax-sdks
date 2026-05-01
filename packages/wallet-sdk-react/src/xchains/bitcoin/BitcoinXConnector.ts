import { XConnector } from '@/core/index.js';
import type { XAccount } from '@/types/index.js';
import type { IBitcoinWalletProvider } from '@sodax/types';
import type { BitcoinWalletDefaults } from '@sodax/wallet-sdk-core';
import { BitcoinXService } from './BitcoinXService.js';

/**
 * Abstract base class for Bitcoin wallet connectors.
 * Subclasses implement wallet-specific connection logic (Unisat, Xverse, OKX).
 *
 * `defaults` carries per-call overrides forwarded to the wallet provider built
 * by each subclass. Currently honored field: `defaultFinalize` — applied to
 * `signTransaction` when the caller omits the `finalize` argument.
 */
export abstract class BitcoinXConnector extends XConnector {
  protected readonly defaults: BitcoinWalletDefaults | undefined;

  constructor(name: string, id: string, defaults?: BitcoinWalletDefaults) {
    super('BITCOIN', name, id);
    this.defaults = defaults;
  }

  getXService(): BitcoinXService {
    return BitcoinXService.getInstance();
  }

  abstract override connect(): Promise<XAccount | undefined>;
  abstract override disconnect(): Promise<void>;

  /**
   * Returns an IBitcoinWalletProvider instance after connecting.
   * Used by useSpokeProvider to build BitcoinSpokeProvider.
   */
  abstract getWalletProvider(): IBitcoinWalletProvider | undefined;

  /**
   * Recreates a walletProvider from the browser extension window object
   * and stored xAccount data (no connect() call, no popup).
   * Used to restore provider after page reload without requiring reconnect.
   */
  abstract recreateWalletProvider(xAccount: XAccount): IBitcoinWalletProvider | undefined;
}
