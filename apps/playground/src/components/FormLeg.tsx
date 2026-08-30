import type { XToken } from '@sodax/dapp-kit';
import { type PlaygroundChainKey, chainName } from '../lib/chains';
import { formatTokenAmount } from '../lib/format';

export type FormLegProps = {
  label: string;
  chains: readonly PlaygroundChainKey[];
  chain: PlaygroundChainKey;
  chainLabel: string;
  onChainChange: (key: PlaygroundChainKey) => void;
  tokens: readonly XToken[];
  token: XToken | undefined;
  tokenLabel: string;
  onTokenChange: (token: XToken | undefined) => void;
  amount: string;
  amountLabel: string;
  /** Omitted on a receive leg, which shows a derived amount rather than taking one. */
  onAmountChange?: (value: string) => void;
  emptyTokensLabel: string;
};

/**
 * One side of a two-leg form: network, token, amount. Both flows render two of these, so the
 * spacing that makes the pair fit on one screen lives in one place.
 */
export function FormLeg({
  label,
  chains,
  chain,
  chainLabel,
  onChainChange,
  tokens,
  token,
  tokenLabel,
  onTokenChange,
  amount,
  amountLabel,
  onAmountChange,
  emptyTokensLabel,
}: FormLegProps) {
  // Resolve the raw <select> value against the derived lists instead of casting it to a key.
  const handleChain = (raw: string) => {
    const next = chains.find(key => key === raw);
    if (next) onChainChange(next);
  };

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="row">
        <select className="select" aria-label={chainLabel} value={chain} onChange={e => handleChain(e.target.value)}>
          {chains.map(key => (
            <option key={key} value={key}>
              {chainName(key)}
            </option>
          ))}
        </select>
        <select
          className="select"
          aria-label={tokenLabel}
          value={token?.address ?? ''}
          disabled={tokens.length === 0}
          onChange={e => onTokenChange(tokens.find(item => item.address === e.target.value))}
        >
          {tokens.length === 0 && <option value="">{emptyTokensLabel}</option>}
          {tokens.map(item => (
            <option key={item.address} value={item.address}>
              {item.symbol}
            </option>
          ))}
        </select>
      </div>
      {onAmountChange ? (
        <input
          className="input amount"
          aria-label={amountLabel}
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={e => onAmountChange(e.target.value)}
        />
      ) : (
        <input
          className="input amount"
          aria-label={amountLabel}
          value={formatTokenAmount(amount)}
          title={amount}
          placeholder="0.0"
          readOnly
        />
      )}
    </div>
  );
}

export function FlipButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flip">
      <button
        type="button"
        className="btn btn-icon"
        onClick={onClick}
        aria-label="Reverse direction"
        title="Reverse direction"
      >
        ⇅
      </button>
    </div>
  );
}
