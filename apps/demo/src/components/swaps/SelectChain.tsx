'use client';

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SpokeChainKey } from '@sodax/dapp-kit';
import { Label } from '@/components/ui/label';
import { chainIdToChainName, chainIdToChainLogo } from '@/constants';

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
  return (
    <div className="space-y-2">
      {label && <Label htmlFor={id}>{label}</Label>}
      <Select value={value.toString()} onValueChange={v => setChain(v as SpokeChainKey)}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {chainList.map(chain => (
            <SelectItem key={chain} value={chain.toString()}>
              <span className="flex items-center gap-2">
                <img src={chainIdToChainLogo(chain)} alt="" className="h-4 w-4 rounded-full" />
                {chainIdToChainName(chain)}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
