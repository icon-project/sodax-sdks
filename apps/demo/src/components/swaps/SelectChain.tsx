'use client';

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SpokeChainKey } from '@sodax/dapp-kit';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { chainIdToChainName, chainIdToChainLogo } from '@/constants';
import { useRadixSearchInput } from '@/hooks/useRadixSearchInput';

export function SelectChain({
  chainList,
  value,
  setChain,
  placeholder,
  id,
  label,
}: {
  chainList: SpokeChainKey[];
  value: SpokeChainKey;
  setChain: (value: SpokeChainKey) => void;
  placeholder?: string;
  id?: string;
  label?: string;
}) {
  const { search, inputProps, handleOpenChange } = useRadixSearchInput();
  const q = search.trim().toLowerCase();
  const filtered = q ? chainList.filter(chain => chainIdToChainName(chain).toLowerCase().includes(q)) : chainList;

  return (
    <div className="space-y-2">
      {label && <Label htmlFor={id}>{label}</Label>}
      <Select
        value={value.toString()}
        onValueChange={v => setChain(v as SpokeChainKey)}
        onOpenChange={handleOpenChange}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <div className="sticky top-0 z-10 bg-white p-1">
            <Input autoFocus placeholder="Search network..." className="h-8" {...inputProps} />
          </div>
          {filtered.length === 0 ? (
            <div className="px-2 py-3 text-center text-sm text-muted-foreground">No network found</div>
          ) : (
            filtered.map(chain => (
              <SelectItem key={chain} value={chain.toString()}>
                <span className="flex items-center gap-2">
                  <img src={chainIdToChainLogo(chain)} alt="" className="h-4 w-4 rounded-full" />
                  {chainIdToChainName(chain)}
                </span>
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
