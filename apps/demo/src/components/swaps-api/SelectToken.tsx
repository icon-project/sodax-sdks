'use client';

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import type { SwapTokenV2 } from '@sodax/dapp-kit';
import { useRadixSearchInput } from '@/hooks/useRadixSearchInput';
import { TokenIcon } from '@/components/shared/TokenIcon';

// Searchable token dropdown for the Swaps API token map (SwapTokenV2). Mirrors
// components/swaps/SelectToken but typed to the Swaps API token shape.
export function SelectToken({
  tokens,
  value,
  onSelect,
  className,
}: {
  tokens: readonly SwapTokenV2[];
  /** Selected token symbol. */
  value?: string;
  onSelect: (token: SwapTokenV2) => void;
  className?: string;
}) {
  const { search, inputProps, handleOpenChange } = useRadixSearchInput();
  const q = search.trim().toLowerCase();
  const filtered = q ? tokens.filter(t => t.symbol.toLowerCase().includes(q)) : tokens;

  return (
    <Select
      value={value}
      onValueChange={v => {
        const token = tokens.find(t => t.symbol === v);
        if (token) onSelect(token);
      }}
      onOpenChange={handleOpenChange}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder="Token" />
      </SelectTrigger>
      <SelectContent>
        <div className="sticky top-0 z-10 bg-white p-1">
          <Input autoFocus placeholder="Search token..." className="h-8" {...inputProps} />
        </div>
        {filtered.length === 0 ? (
          <div className="px-2 py-3 text-center text-sm text-muted-foreground">No token found</div>
        ) : (
          filtered.map(token => (
            <SelectItem key={`${token.address}-${token.symbol}`} value={token.symbol}>
              <span className="flex items-center gap-2">
                <TokenIcon symbol={token.symbol} />
                {token.symbol}
              </span>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
