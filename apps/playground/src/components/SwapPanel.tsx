import { EXCHANGE_URL } from '../config';
import type { SwapFlow } from '../hooks/useSwapFlow';
import type { TokenChoice } from '../lib/chains';
import { FEE_BPS_MAX } from '../lib/fee';
import { formatTokenAmount } from '../lib/format';
import { AssetPicker } from './AssetPicker';
import { AssetPanel, FlipButton } from './AssetPanel';

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
        Integration is free, and this fee is yours in full — SODAX takes no share of it. The quote above stays net of
        it.
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

/**
 * The widget cannot sign — no wallet layer is mounted — so a quotable pair hands off to the
 * exchange instead of gating behind a connect button. Every other state is the form telling the
 * visitor why there is no quote yet.
 */
function PrimaryAction({ flow }: { flow: SwapFlow }) {
  const disabled = (text: string) => (
    <button type="button" className="btn btn-primary" disabled>
      {text}
    </button>
  );

  if (!flow.srcToken || !flow.dstToken) return disabled('No assets on this network');
  if (!flow.isAmountValid) return disabled('Enter an amount');
  if (!flow.isSlippageValid) return disabled('Slippage must be between 0 and 100');
  if (flow.partnerFeeError) return disabled('Fix the partner fee');
  if (flow.quoteError) return disabled('No route available');
  if (!flow.hasQuote) return disabled(flow.isQuoting ? 'Fetching quote…' : 'Enter an amount');

  return (
    <a className="btn btn-primary" href={EXCHANGE_URL} target="_blank" rel="noreferrer">
      Swap {flow.srcToken.symbol} → {flow.dstToken.symbol} ↗
    </a>
  );
}

function LoadingForm({ message }: { message: string }) {
  return (
    <section className="card swap-card">
      <div className="asset-panel asset-panel-skeleton" aria-hidden="true" />
      <FlipButton onClick={() => {}} />
      <div className="asset-panel asset-panel-skeleton" aria-hidden="true" />
      <p className="muted small" role="status">
        {message}
      </p>
    </section>
  );
}

export function SwapPanel({ flow }: { flow: SwapFlow }) {
  // A pick carries its own chain, so one selection sets both. The chain change re-resolves the
  // token against the new chain's list by symbol, which returns the very token that was picked.
  const selectSrc = (choice: TokenChoice) => {
    flow.setSrcChain(choice.chain);
    flow.setSrcToken(choice.token);
  };

  const selectDst = (choice: TokenChoice) => {
    flow.setDstChain(choice.chain);
    flow.setDstToken(choice.token);
  };

  // Read out before the guard: inside the picker callbacks TS cannot keep a property narrowed.
  const { srcChain, dstChain } = flow;

  if (flow.assetsError) return <LoadingForm message={flow.assetsError} />;
  if (!srcChain || !dstChain) return <LoadingForm message="Loading assets…" />;

  return (
    <section className="card swap-card">
      <AssetPanel
        symbol={flow.srcToken?.symbol}
        chain={srcChain}
        emptyLabel="No assets"
        pickerLabel="Asset to send"
        picker={state => (
          <AssetPicker
            {...state}
            groups={flow.groups}
            networks={flow.chains}
            selected={flow.srcToken && { chain: srcChain, symbol: flow.srcToken.symbol }}
            onSelect={selectSrc}
          />
        )}
        amount={flow.amount}
        amountLabel="Amount to send"
        onAmountChange={flow.setAmount}
        note={flow.partnerFee ? `less ${formatTokenAmount(flow.partnerFeeAmount)} fee` : undefined}
      />

      <FlipButton onClick={flow.flipDirection} />

      <AssetPanel
        symbol={flow.dstToken?.symbol}
        chain={dstChain}
        emptyLabel="No assets"
        pickerLabel="Asset to receive"
        picker={state => (
          <AssetPicker
            {...state}
            groups={flow.groups}
            networks={flow.chains}
            selected={flow.dstToken && { chain: dstChain, symbol: flow.dstToken.symbol }}
            onSelect={selectDst}
          />
        )}
        amount={flow.quotedOutput}
        amountLabel="Amount to receive"
        note={flow.hasQuote ? (flow.isQuoting ? 'refreshing…' : 'live quote, every 3s') : undefined}
      />

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
      </div>

      <PartnerFeeFields flow={flow} />

      {flow.partnerFeeError && (
        <p className="alert" role="alert">
          {flow.partnerFeeError}
        </p>
      )}

      {flow.quoteError && (
        <p className="alert" role="alert">
          {flow.quoteError} Try another pair, or a smaller amount.
        </p>
      )}

      <PrimaryAction flow={flow} />

      <p className="muted small action-note">
        Quotes are live off mainnet liquidity. The widget connects no wallet and cannot move funds — signing happens on
        sodax.com.
      </p>
    </section>
  );
}
