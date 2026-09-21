import React from 'react';
import { tokenLogo } from '@sodax/dapp-kit';
import { cn } from '@/lib/utils';

/**
 * Token logo resolved from its symbol via `tokenLogo` (@sodax/types), hosted in
 * @sodax/assets.
 */
export function TokenIcon({ symbol, className }: { symbol: string; className?: string }) {
  return (
    <img
      src={tokenLogo(symbol)}
      alt=""
      aria-hidden
      className={cn('h-5 w-5 shrink-0 rounded-full object-contain', className)}
    />
  );
}
