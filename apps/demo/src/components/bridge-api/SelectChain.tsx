'use client';

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SpokeChainKey } from '@sodax/dapp-kit';
import { Label } from '@/components/ui/label';
import { chainIdToChainName } from '@/constants';

// Chain keys come straight from the Bridge API token map, so display an unknown key as-is
// rather than crashing on a config lookup.
function chainDisplayName(chain: string): string {
  try {
    return chainIdToChainName(chain as SpokeChainKey) ?? chain;
  } catch {
    return chain;
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
  return (
    <div className="space-y-2">
      {label && <Label htmlFor={id}>{label}</Label>}
      <Select value={value} onValueChange={setChain}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {chainList.map(chain => (
            <SelectItem key={chain} value={chain}>
              {chainDisplayName(chain)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
