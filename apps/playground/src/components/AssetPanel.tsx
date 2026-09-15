import type { ChainKey } from '@sodax/dapp-kit';
import { type ReactNode, useState } from 'react';
import { chainName } from '../lib/chains';
import { formatTokenAmount } from '../lib/format';
import { AssetLogo } from './AssetLogo';

export type AssetPanelProps = {
  /** Undefined while the chain carries no token for this flow — the picker still opens. */
  symbol: string | undefined;
  chain: ChainKey;
  emptyLabel: string;
  pickerLabel: string;
  /** Rendered with `open`/`onClose`, so the panel owns the trigger and the picker owns the choosing. */
  picker: (state: { open: boolean; onClose: () => void }) => ReactNode;
  amount: string;
  amountLabel: string;
  /** Omitted on a receive leg, which shows a derived amount rather than taking one. */
  onAmountChange?: (value: string) => void;
  note?: ReactNode;
};

/**
 * One side of a two-leg form, shaped like the `sodax.com/exchange/swap` currency panel: the asset
 * and its network on the left, the amount on the right, and the whole panel a picker trigger.
 */
export function AssetPanel({
  symbol,
  chain,
  emptyLabel,
  pickerLabel,
  picker,
  amount,
  amountLabel,
  onAmountChange,
  note,
}: AssetPanelProps) {
  const [isOpen, setOpen] = useState(false);

  return (
    <div className="asset-panel">
      <div className="asset-row">
        <button
          type="button"
          className="asset-id"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={pickerLabel}
        >
          <AssetLogo symbol={symbol ?? '?'} chain={chain} />
          <span className="asset-id-text">
            <span className="asset-symbol">
              {symbol ?? emptyLabel}
              <svg className="asset-chevron" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
            <span className="asset-chain">{chainName(chain)}</span>
          </span>
        </button>

        <span className="asset-amount">
          {onAmountChange ? (
            <input
              className="input amount"
              aria-label={amountLabel}
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={event => onAmountChange(event.target.value)}
            />
          ) : (
            <input
              className="input amount"
              aria-label={amountLabel}
              value={formatTokenAmount(amount)}
              title={amount}
              placeholder="0"
              readOnly
            />
          )}
          <span className="asset-note">{note}</span>
        </span>
      </div>

      {picker({ open: isOpen, onClose: () => setOpen(false) })}
    </div>
  );
}

export function FlipButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flip">
      <button
        type="button"
        className="btn btn-icon flip-btn"
        onClick={onClick}
        aria-label="Reverse direction"
        title="Reverse direction"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M5 2v12M5 14l-2.5-2.5M5 14l2.5-2.5M11 14V2M11 2L8.5 4.5M11 2l2.5 2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
