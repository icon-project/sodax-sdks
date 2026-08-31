import React, { useMemo, useState } from 'react';
import type { PartnerFeeV2 } from '@sodax/dapp-kit';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore } from '@/zustand/useAppStore';
import {
  bpsToPercentText,
  isEvmAddress,
  MAX_PARTNER_FEE_PERCENT,
  partnerFeePercentError,
  percentTextToBps,
} from '@/lib/sodaxSettings';

export type PartnerFeeDraft = {
  address: string;
  percent: string;
  setAddress: (value: string) => void;
  setPercent: (value: string) => void;
  /** Wire value for the request body. `undefined` omits `partnerFee`, which the two APIs read
   *  differently: bridge falls back to its configured fee, swaps charges nothing. */
  partnerFee: PartnerFeeV2 | undefined;
  error: string | undefined;
};

/**
 * Per-request partner fee for the API showcase pages, seeded once from Sodax Settings so the modal
 * stays the single place a fee is configured. `providers.tsx` keys the children on the settings, so
 * a save remounts the page and the seed is re-read; editing here only affects this page's requests.
 *
 * Entered as a percent but sent as basis points — `PartnerFeeV2` mirrors the SDK's `PartnerFee`,
 * whose `percentage` is bps, so one settings value drives the SDK and both API routes.
 */
export function usePartnerFeeDraft(): PartnerFeeDraft {
  const [address, setAddress] = useState(() => useAppStore.getState().sodaxSettings.partnerFeeAddress ?? '');
  const [percent, setPercent] = useState(() => {
    const seeded = useAppStore.getState().sodaxSettings.partnerFeeBps;
    return seeded === null ? '' : bpsToPercentText(seeded);
  });

  const error = useMemo((): string | undefined => {
    const trimmedAddress = address.trim();
    const trimmedPercent = percent.trim();
    if (trimmedAddress && !isEvmAddress(trimmedAddress)) {
      return 'Fee address must be a 0x-prefixed 20-byte address';
    }
    const percentError = partnerFeePercentError(trimmedPercent);
    if (percentError) return percentError;
    // `PartnerFeeV2` is one object — a lone address or a lone rate can't be sent.
    if (trimmedAddress && !trimmedPercent) return 'Set a fee rate, or clear the address';
    if (trimmedPercent && !trimmedAddress) return 'Set a fee address, or clear the rate';
    return undefined;
  }, [address, percent]);

  const partnerFee = useMemo((): PartnerFeeV2 | undefined => {
    const trimmedAddress = address.trim();
    const bps = percentTextToBps(percent);
    if (error || !trimmedAddress || bps === null) return undefined;
    return { address: trimmedAddress, percentage: bps };
  }, [address, percent, error]);

  return { address, percent, setAddress, setPercent, partnerFee, error };
}

/** `unsetBehavior` names what the route does when `partnerFee` is omitted — the two differ. */
export function PartnerFeeFields({ draft, unsetBehavior }: { draft: PartnerFeeDraft; unsetBehavior: string }) {
  const bps = percentTextToBps(draft.percent);
  const bpsReadout = bps === null ? '' : `= ${bps} bps. `;
  return (
    <div className="grow">
      <Label>Partner fee (optional)</Label>
      <div className="flex space-x-2">
        <Input
          type="text"
          placeholder="Fee receiver address (0x…)"
          value={draft.address}
          onChange={e => draft.setAddress(e.target.value)}
        />
        <Input
          type="number"
          step="0.01"
          className="w-[130px]"
          placeholder={`% (max ${MAX_PARTNER_FEE_PERCENT})`}
          value={draft.percent}
          onChange={e => draft.setPercent(e.target.value)}
        />
      </div>
      <p className={`mt-1 text-xs ${draft.error ? 'text-red-500' : 'text-muted-foreground'}`}>
        {draft.error ?? `${bpsReadout}Seeded from Sodax Settings; clear both to ${unsetBehavior}.`}
      </p>
    </div>
  );
}
