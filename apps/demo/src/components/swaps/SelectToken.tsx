'use client';

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import type { XToken } from '@sodax/dapp-kit';
import { useRadixSearchInput } from '@/hooks/useRadixSearchInput';

export function SelectToken({
  tokens,
  value,
  onSelect,
  className,
}: {
  tokens: readonly XToken[];
  /** Selected token symbol. */
  value?: string;
  onSelect: (token: XToken) => void;
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
              {token.symbol}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
