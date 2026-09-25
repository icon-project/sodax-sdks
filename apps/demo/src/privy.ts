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
  return privy({ appId, disconnectBehavior: 'detach' });
}
