'use client';

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SpokeChainKey } from '@sodax/dapp-kit';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { chainIdToChainName, chainIdToChainLogo } from '@/constants';
import { useRadixSearchInput } from '@/hooks/useRadixSearchInput';

// Chain keys come straight from the Swaps API token map, so a key may not exist in the local
// config — resolve name/logo defensively (show the raw key / no logo) instead of crashing on the
// config lookup (chainIdToChain* index into spokeChainConfig and throw on an unknown key).
function chainDisplayName(chain: string): string {
  try {
    return chainIdToChainName(chain as SpokeChainKey) ?? chain;
  } catch {
    return chain;
  }
}

function chainLogo(chain: string): string | undefined {
  try {
    return chainIdToChainLogo(chain as SpokeChainKey);
  } catch {
    return undefined;
  }
}

export function SelectChain({
  chainList,
  value,
  setChain,
  placeholder,
  id,
  label,
}: {
  chainList: string[];
  value: string;
  setChain: (value: string) => void;
  placeholder?: string;
  id?: string;
  label?: string;
}) {
  const { search, inputProps, handleOpenChange } = useRadixSearchInput();
  const q = search.trim().toLowerCase();
  const filtered = q ? chainList.filter(chain => chainDisplayName(chain).toLowerCase().includes(q)) : chainList;

  return (
    <div className="space-y-2">
      {label && <Label htmlFor={id}>{label}</Label>}
      <Select value={value} onValueChange={setChain} onOpenChange={handleOpenChange}>
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
            filtered.map(chain => {
              const logo = chainLogo(chain);
              return (
                <SelectItem key={chain} value={chain}>
                  <span className="flex items-center gap-2">
                    {logo && <img src={logo} alt="" className="h-4 w-4 rounded-full" />}
                    {chainDisplayName(chain)}
                  </span>
                </SelectItem>
              );
            })
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
