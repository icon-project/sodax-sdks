'use client';

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useRadixSearchInput } from '@/hooks/useRadixSearchInput';
import { TokenIcon } from '@/components/shared/TokenIcon';

/** Searchable token dropdown; works for any token shape carrying name + symbol + address (XToken, SwapTokenV2). */
export function SelectToken<T extends { name: string; symbol: string; address: string }>({
  tokens,
  value,
  onSelect,
  className,
}: {
  tokens: readonly T[];
  /** Selected token symbol. */
  value?: string;
  onSelect: (token: T) => void;
  className?: string;
}) {
  const { search, inputProps, handleOpenChange } = useRadixSearchInput();
  const q = search.trim().toLowerCase();
  const filtered = q
    ? tokens.filter(t => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
    : tokens;

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
        {/* Radix strips className from SelectValue, so the wrapper is what lets the name truncate. */}
        <span className="min-w-0 flex-1 overflow-hidden">
          <SelectValue placeholder="Token" />
        </span>
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
              <span className="flex min-w-0 items-center gap-2">
                <TokenIcon symbol={token.symbol} />
                <span className="truncate">{token.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{token.symbol}</span>
              </span>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
