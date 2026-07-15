import { useEffect, useState } from 'react';
import { tokenLogo } from '@sodax/dapp-kit';
import { cn } from '@/lib/utils';

/**
 * Token logo resolved from its symbol via `tokenLogo` (@sodax/types), hosted in
 * @sodax/assets. Falls back to the symbol's first letters if the image is missing
 * (e.g. an icon not yet merged to `main`, so the raw.githubusercontent URL 404s).
 */
export function TokenIcon({ symbol, className }: { symbol: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  // reset when the symbol changes so a reused instance re-attempts the new logo
  useEffect(() => setFailed(false), [symbol]);

  const base = cn('h-5 w-5 shrink-0 rounded-full', className);
  if (failed) {
    return (
      <span
        className={cn(base, 'flex items-center justify-center bg-muted text-[9px] font-semibold uppercase text-muted-foreground')}
        title={symbol}
      >
        {symbol.slice(0, 2)}
      </span>
    );
  }
  return (
    <img
      src={tokenLogo(symbol)}
      alt=""
      aria-hidden
      className={cn(base, 'object-contain')}
      onError={() => setFailed(true)}
    />
  );
}
