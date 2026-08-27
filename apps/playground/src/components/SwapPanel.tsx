import type { SwapFlow } from '../hooks/useSwapFlow';
import { type PlaygroundChainKey, chainName, swappableChains } from '../lib/chains';
import { StatusPanel } from './StatusPanel';

function ChainSelect({ value, onChange }: { value: PlaygroundChainKey; onChange: (key: PlaygroundChainKey) => void }) {
  // Resolve the raw <select> value against the derived list instead of casting it to a chain key.
  const handleChange = (raw: string) => {
    const next = swappableChains.find(key => key === raw);
    if (next) onChange(next);
  };

  return (
    <select className="select" value={value} onChange={event => handleChange(event.target.value)}>
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
    <section className="card">
      <div className="field">
        <span className="field-label">From</span>
        <div className="row">
          <ChainSelect value={flow.srcChain} onChange={flow.setSrcChain} />
          <select
            className="select"
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
          inputMode="decimal"
          placeholder="0.0"
          value={flow.amount}
          onChange={event => flow.setAmount(event.target.value)}
        />
      </div>

      <div className="flip">
        <button type="button" className="btn btn-icon" onClick={flow.flipDirection} title="Reverse direction">
          ⇅
        </button>
      </div>

      <div className="field">
        <span className="field-label">To</span>
        <div className="row">
          <ChainSelect value={flow.dstChain} onChange={flow.setDstChain} />
          <select
            className="select"
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
        <input className="input amount" value={flow.quotedOutput} placeholder="0.0" readOnly />
      </div>

      <div className="summary">
        <div className="row-between">
          <span className="muted">Slippage</span>
          <span className="slippage">
            <input
              className="input slip"
              inputMode="decimal"
              value={flow.slippagePercent}
              onChange={event => flow.setSlippagePercent(event.target.value)}
            />
            %
          </span>
        </div>
        <div className="row-between">
          <span className="muted">Minimum received</span>
          <span>{flow.minReceived ? `${flow.minReceived} ${flow.dstToken?.symbol ?? ''}` : '—'}</span>
        </div>
        {flow.hasQuote && (
          <div className="row-between">
            <span className="muted small">Quote refreshes every 3s</span>
            <span className="muted small">{flow.isQuoting ? 'refreshing…' : 'live'}</span>
          </div>
        )}
      </div>

      {flow.quoteError && <p className="alert">{flow.quoteError}</p>}

      {flow.error && (
        <div className="alert">
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
