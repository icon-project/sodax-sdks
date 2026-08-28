import type { SwapFlow } from '../hooks/useSwapFlow';
import { type PlaygroundChainKey, chainName, swappableChains } from '../lib/chains';
import { FEE_BPS_MAX } from '../lib/fee';
import { formatTokenAmount } from '../lib/format';
import { StatusPanel } from './StatusPanel';

/** Display precision only — `title` keeps the exact value one hover away. */
function Amount({ value, symbol }: { value: string; symbol: string | undefined }) {
  if (!value) return <span>—</span>;
  return (
    <span title={`${value}${symbol ? ` ${symbol}` : ''}`}>
      {formatTokenAmount(value)} {symbol ?? ''}
    </span>
  );
}

function PartnerFeeFields({ flow }: { flow: SwapFlow }) {
  const { address, bps } = flow.partnerFeeInput;

  return (
    <details className="disclosure">
      <summary>Charge a partner fee</summary>
      <p className="muted small">
        Integration is free and SODAX takes none of it. The quote above stays net of your fee.
      </p>
      <div className="row">
        <input
          className="input"
          aria-label="Partner fee recipient on Sonic"
          placeholder="Recipient on Sonic (0x…)"
          value={address}
          onChange={event => flow.setPartnerFeeInput({ address: event.target.value, bps })}
        />
        <input
          className="input fee-bps"
          aria-label="Partner fee in basis points"
          inputMode="numeric"
          placeholder="bps"
          value={bps}
          onChange={event => flow.setPartnerFeeInput({ address, bps: event.target.value })}
        />
      </div>
      <p className="muted small">
        Up to {FEE_BPS_MAX} bps ({FEE_BPS_MAX / 100}%). The recipient is not validated — a wrong address is unclaimable.
      </p>
    </details>
  );
}

function ChainSelect({
  value,
  onChange,
  label,
}: {
  value: PlaygroundChainKey;
  onChange: (key: PlaygroundChainKey) => void;
  label: string;
}) {
  // Resolve the raw <select> value against the derived list instead of casting it to a chain key.
  const handleChange = (raw: string) => {
    const next = swappableChains.find(key => key === raw);
    if (next) onChange(next);
  };

  return (
    <select className="select" aria-label={label} value={value} onChange={event => handleChange(event.target.value)}>
      {swappableChains.map(key => (
        <option key={key} value={key}>
          {chainName(key)}
        </option>
      ))}
    </select>
  );
}

function PrimaryAction({ flow }: { flow: SwapFlow }) {
  const label = (text: string) => (
    <button type="button" className="btn btn-primary" disabled>
      {text}
    </button>
  );

  if (!flow.srcToken || !flow.dstToken) return label('No swap tokens on this chain');
  if (!flow.isAmountValid) return label('Enter an amount');
  if (!flow.isSlippageValid) return label('Slippage must be between 0 and 100');
  if (flow.partnerFeeError) return label('Fix the partner fee');
  if (flow.quoteError) return label('No route available');
  if (!flow.hasQuote) return label(flow.isQuoting ? 'Fetching quote…' : 'Enter an amount');

  if (!flow.canSign) return label('Quote-only deployment');
  if (!flow.isConnected) return label('Connect a wallet to swap');

  if (flow.isWrongChain) {
    return (
      <button type="button" className="btn btn-primary" onClick={flow.handleSwitchChain}>
        Switch wallet to {chainName(flow.srcChain)}
      </button>
    );
  }

  if (flow.isCheckingAllowance) return label('Checking approval…');

  if (!flow.hasAllowance) {
    return (
      <button type="button" className="btn btn-primary" onClick={flow.approve} disabled={flow.isApproving}>
        {flow.isApproving ? 'Approving…' : `Approve ${flow.srcToken.symbol}`}
      </button>
    );
  }

  return (
    <button type="button" className="btn btn-primary" onClick={flow.executeSwap} disabled={flow.isSwapping}>
      {flow.isSwapping ? 'Swapping…' : `Swap ${flow.srcToken.symbol} → ${flow.dstToken.symbol}`}
    </button>
  );
}

export function SwapPanel({ flow }: { flow: SwapFlow }) {
  return (
    <section className="card swap-card">
      <div className="field">
        <span className="field-label">From</span>
        <div className="row">
          <ChainSelect value={flow.srcChain} onChange={flow.setSrcChain} label="Network to send from" />
          <select
            className="select"
            aria-label="Token to send"
            value={flow.srcToken?.address ?? ''}
            onChange={event => flow.setSrcToken(flow.srcTokens.find(token => token.address === event.target.value))}
          >
            {flow.srcTokens.map(token => (
              <option key={token.address} value={token.address}>
                {token.symbol}
              </option>
            ))}
          </select>
        </div>
        <input
          className="input amount"
          aria-label="Amount to send"
          inputMode="decimal"
          placeholder="0.0"
          value={flow.amount}
          onChange={event => flow.setAmount(event.target.value)}
        />
      </div>

      <div className="flip">
        <button
          type="button"
          className="btn btn-icon"
          onClick={flow.flipDirection}
          aria-label="Reverse swap direction"
          title="Reverse direction"
        >
          ⇅
        </button>
      </div>

      <div className="field">
        <span className="field-label">To</span>
        <div className="row">
          <ChainSelect value={flow.dstChain} onChange={flow.setDstChain} label="Network to receive on" />
          <select
            className="select"
            aria-label="Token to receive"
            value={flow.dstToken?.address ?? ''}
            onChange={event => flow.setDstToken(flow.dstTokens.find(token => token.address === event.target.value))}
          >
            {flow.dstTokens.map(token => (
              <option key={token.address} value={token.address}>
                {token.symbol}
              </option>
            ))}
          </select>
        </div>
        <input
          className="input amount"
          aria-label="Amount to receive"
          value={formatTokenAmount(flow.quotedOutput)}
          title={flow.quotedOutput}
          placeholder="0.0"
          readOnly
        />
      </div>

      <div className="summary">
        <div className="row-between">
          <span className="muted">Slippage</span>
          <span className="slippage">
            <input
              className="input slip"
              aria-label="Slippage tolerance, percent"
              inputMode="decimal"
              value={flow.slippagePercent}
              onChange={event => flow.setSlippagePercent(event.target.value)}
            />
            %
          </span>
        </div>
        {flow.partnerFee && (
          <div className="row-between">
            <span className="muted">Your fee ({flow.partnerFee.percentage / 100}%)</span>
            <Amount value={flow.partnerFeeAmount} symbol={flow.srcToken?.symbol} />
          </div>
        )}
        <div className="row-between">
          <span className="muted">Minimum received</span>
          <Amount value={flow.minReceived} symbol={flow.dstToken?.symbol} />
        </div>
        {flow.speedTier && (
          <div className="row-between">
            <span className="muted">Settles in</span>
            <span>~{flow.speedTier.estimatedSeconds}s</span>
          </div>
        )}
        {flow.hasQuote && (
          <div className="row-between">
            <span className="muted small">Quote refreshes every 3s</span>
            <span className="muted small">{flow.isQuoting ? 'refreshing…' : 'live'}</span>
          </div>
        )}
      </div>

      <PartnerFeeFields flow={flow} />

      {flow.partnerFeeError && (
        <p className="alert" role="alert">
          {flow.partnerFeeError}
        </p>
      )}

      {flow.quoteError && (
        <p className="alert" role="alert">
          {flow.quoteError}
        </p>
      )}

      {flow.error && (
        <div className="alert" role="alert">
          {flow.error.message}
          {flow.error.detail && (
            <details>
              <summary>Underlying error</summary>
              <code>{flow.error.detail}</code>
            </details>
          )}
        </div>
      )}

      <PrimaryAction flow={flow} />

      {flow.delivery && <StatusPanel delivery={flow.delivery} statusCode={flow.statusCode} />}
    </section>
  );
}
