// Fetches SodaxScan message URL for a given source tx hash for use in success modals.

import { useEffect, useState } from 'react';
import { getSodaxScanMessageUrl } from '@/lib/sodaxScan';

export interface UseSodaxScanMessageUrlResult {
  url: string | null;
  isLoading: boolean;
}

/**
 * Polling options for {@link useSodaxScanMessageUrl}.
 *
 * Defaults are tuned for cross-chain messages (especially Bitcoin on-demand borrow/withdraw) that can
 * take longer than a few seconds to appear in SodaxScan's index after the relay reports executed —
 * a wider window lets the link resolve once the message is indexed instead of giving up while it is
 * still propagating (which would otherwise leave no link at all for od:<hash> ids, no explorer fallback).
 */
export interface UseSodaxScanMessageUrlOptions {
  /** Max number of re-fetch attempts before giving up. Default: 10. */
  maxRetries?: number;
  /** Delay between attempts, in milliseconds. Default: 3000. */
  retryDelay?: number;
}

const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_RETRY_DELAY = 3000;

export interface UseSodaxScanMessageUrlParams {
  txHash: string | undefined;
  options?: UseSodaxScanMessageUrlOptions;
}

/**
 * Resolves a transaction hash to a SodaxScan message URL.
 * Used by money market success modals to link to "View on SodaxScan" instead of chain explorer. If not available, fallback to explorerUrl
 */
export function useSodaxScanMessageUrl({
  txHash,
  options,
}: UseSodaxScanMessageUrlParams): UseSodaxScanMessageUrlResult {
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelay = options?.retryDelay ?? DEFAULT_RETRY_DELAY;

  useEffect(() => {
    if (!txHash) {
      setUrl(null);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryCount = 0;

    const fetchUrl = async (): Promise<void> => {
      try {
        const resolved = await getSodaxScanMessageUrl(txHash);
        if (cancelled) return;
        if (resolved) {
          setUrl(resolved);
          setIsLoading(false);
        } else if (retryCount < maxRetries) {
          retryCount++;
          retryTimer = setTimeout(fetchUrl, retryDelay);
        } else {
          setUrl(null);
          setIsLoading(false);
        }
      } catch {
        if (cancelled) return;
        setUrl(null);
        setIsLoading(false);
      }
    };

    setIsLoading(true);
    setUrl(null);
    fetchUrl();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
  }, [txHash, maxRetries, retryDelay]);

  return { url, isLoading };
}
