import type { PrivySource } from '@sodax/wallet-sdk-react';
import { effectivePrivyAppId, loadSodaxSettings } from './lib/sodaxSettings';

/**
 * "Email (Privy)" is opt-in: set the Privy app id in Sodax Settings or `VITE_PRIVY_APP_ID` (see `example.env`).
 * Unset, the Privy chunk is never loaded.
 */
export async function loadPrivySource(): Promise<PrivySource | undefined> {
  const appId = effectivePrivyAppId(loadSodaxSettings());
  if (!appId) return undefined;
  const { privy } = await import('@sodax/wallet-sdk-react/privy');
  // Testers reconnect without a new code; `'logout'` (the default) suits shared devices.
  // No Privy UI: with it a send resolves only once its success screen is closed; the demo's review dialog confirms.
  return privy({ appId, disconnectBehavior: 'detach', showWalletUIs: false });
}

/** Privy renders its modal (login, confirmations, MFA) in `#privy-dialog`, outside the demo's dialogs and sheets. */
export function isInPrivyDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('#privy-dialog') !== null;
}
