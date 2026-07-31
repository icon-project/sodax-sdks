import type { XAccount } from '../../types/index.js';
import { XConnector } from '../../core/index.js';
// Wallet is the type from useWallet().wallets — each entry has .adapter (name, icon, url) and .readyState.
import type { Wallet } from '@provablehq/aleo-wallet-adaptor-react';
import { AleoXService } from './AleoXService.js';

export class AleoXConnector extends XConnector {
  wallet: Wallet;

  constructor(wallet: Wallet) {
    super('ALEO', wallet?.adapter.name, wallet?.adapter.name);
    this.wallet = wallet;
  }

  getXService(): AleoXService {
    return AleoXService.getInstance();
  }

  // Provider-managed — actual connect lifecycle is owned by AleoActions via
  // useWallet().connect / .disconnect. The connector exists only as a metadata
  // wrapper (name, icon, install URL) for chain-list / wallet-modal UIs.
  async connect(): Promise<XAccount | undefined> {
    return;
  }

  async disconnect(): Promise<void> {}

  public override get icon(): string | undefined {
    return this.wallet?.adapter.icon;
  }

  public override get isInstalled(): boolean {
    // WalletReadyState string values from @provablehq/aleo-wallet-standard.
    // Match Solana's convention: treat 'Installed' (extension injected) and
    // 'Loadable' (adapter can bootstrap on demand) as installed.
    const state = this.wallet?.readyState as string | undefined;
    return state === 'Installed' || state === 'Loadable';
  }

  public override get installUrl(): string | undefined {
    return this.wallet?.adapter.url;
  }
}
