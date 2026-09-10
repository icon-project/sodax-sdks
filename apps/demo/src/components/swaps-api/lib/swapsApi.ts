import { SwapsApi, SwapsApiError } from '@sodax/swaps-api';
import { useMemo } from 'react';
import { effectiveSodaxApiKey, effectiveSwapsApiBaseUrl } from '@/lib/sodaxSettings';
import { formatMutationFailureMessage } from '@/lib/utils';
import { useAppStore } from '@/zustand/useAppStore';

/**
 * Direct `@sodax/swaps-api` client for this page. Unlike the rest of the demo (which reaches the
 * swaps backend through `sodax.api.swaps` / dapp-kit hooks), this page drives the original wire
 * client itself — dapp-kit stays involved only for wallet/signing and chain-prerequisite concerns
 * the API doesn't cover.
 *
 * Base URL and key come from the same effective settings the provider hands the SDK, because the
 * page's order-status panel polls through `sodax.api.swaps`: a client configured on its own would
 * submit to one deployment and poll another, leaving every order pending. A hook rather than a
 * module singleton because the Sodax Settings modal changes both at runtime.
 */
export function useSwapsApiClient(): SwapsApi {
  const { sodaxSettings } = useAppStore();
  const baseUrl = effectiveSwapsApiBaseUrl(sodaxSettings);
  const apiKey = effectiveSodaxApiKey(sodaxSettings);

  return useMemo(() => new SwapsApi({ baseUrl, ...(apiKey ? { apiKey } : {}) }), [baseUrl, apiKey]);
}

/**
 * Human-readable text for a failed swaps-api call. A `SwapsApiError`'s own message is generic
 * ("createIntent responded with 400"); the backend's explanation sits on `context.body.message`,
 * so prefer that when present. Non-API errors (signing, wallet) keep the shared formatting.
 */
export function formatSwapsApiError(error: unknown, fallback: string): string {
  if (error instanceof SwapsApiError) {
    const body = error.context.body as { message?: string } | undefined;
    return body?.message ?? error.message;
  }
  return formatMutationFailureMessage(error, fallback);
}
