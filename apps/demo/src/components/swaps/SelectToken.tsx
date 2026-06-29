'use client';

import React, { useRef, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import type { XToken } from '@sodax/dapp-kit';

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
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const q = search.trim().toLowerCase();
  const filtered = q ? tokens.filter(t => t.symbol.toLowerCase().includes(q)) : tokens;

  return (
    <Select
      value={value}
      onValueChange={v => {
        const token = tokens.find(t => t.symbol === v);
        if (token) onSelect(token);
      }}
      onOpenChange={open => {
        if (open) {
          // Radix focuses the selected item on open; move focus to the search input instead.
          requestAnimationFrame(() => inputRef.current?.focus());
        } else {
          setSearch('');
        }
      }}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder="Token" />
      </SelectTrigger>
      <SelectContent>
        <div className="sticky top-0 z-10 bg-white p-1">
          <Input
            ref={inputRef}
            autoFocus
            placeholder="Search token..."
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              // Radix re-grabs focus to a list item when the filtered children change — restore it.
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            onKeyDown={e => e.stopPropagation()}
            className="h-8"
          />
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
