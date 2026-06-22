import type { IBitcoinWalletProvider } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { loadRadfiSession, saveRadfiSession } from './useRadfiAuth.js';

export type UseEnsureRadfiAccessTokenVars = {
  walletProvider: IBitcoinWalletProvider;
};

/**
 * Ensure a valid Bound Exchange access token and return it. Refreshes the existing token (no
 * signature prompt) when a refresh token is available, falling back to a full BIP322 re-auth only if
 * refresh fails. Bound tokens are short-lived, so call this right before a Bitcoin-source
 * createIntent — forward the returned token via the typed `extras.accessToken` slot (SDK in-process)
 * or the `accessToken` body field on the backend DTO — or before the client-side sign + co-sign step.
 *
 * @example
 * const { mutateAsync: ensureToken } = useEnsureRadfiAccessToken();
 * const accessToken = await ensureToken({ walletProvider });
 * // SDK in-process (Bitcoin-gated extras):
 * await sodax.swaps.createIntent({ params, extras: { accessToken }, raw: true });
 * // or backend createIntent — token in the body, not an x-bound-access-token header:
 * await createIntent({ body: { ...body, accessToken } });
 */
export function useEnsureRadfiAccessToken({
  mutationOptions,
}: MutationHookParams<string, UseEnsureRadfiAccessTokenVars> = {}): SafeUseMutationResult<
  string,
  Error,
  UseEnsureRadfiAccessTokenVars
> {
  const { sodax } = useSodaxContext();
  return useSafeMutation<string, Error, UseEnsureRadfiAccessTokenVars>({
    mutationKey: ['bitcoin', 'ensureAccessToken'],
    ...mutationOptions,
    mutationFn: async ({ walletProvider }) => {
      const radfi = sodax.spoke.bitcoin.radfi;
      const walletAddress = await walletProvider.getWalletAddress();
      // Seed in-memory tokens from the saved session so a refresh can run without a re-sign popup.
      const session = loadRadfiSession(walletAddress);
      if (session?.refreshToken && !radfi.refreshToken) {
        radfi.setRadfiAccessToken(session.accessToken, session.refreshToken);
      }
      await radfi.ensureRadfiAccessToken(walletProvider);
      const accessToken = radfi.accessToken;
      if (!accessToken) {
        throw new Error('Failed to obtain a Bound Exchange access token');
      }
      // Persist refreshed tokens so a later reload can refresh again without re-signing.
      if (session) {
        saveRadfiSession(walletAddress, { ...session, accessToken, refreshToken: radfi.refreshToken });
      }
      return accessToken;
    },
  });
}
