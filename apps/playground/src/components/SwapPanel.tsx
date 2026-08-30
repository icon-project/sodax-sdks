import type { SwapFlow } from '../hooks/useSwapFlow';
import { chainName, swappableChains } from '../lib/chains';
import { FEE_BPS_MAX } from '../lib/fee';
import { formatTokenAmount } from '../lib/format';
import { FlipButton, FormLeg } from './FormLeg';
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
      <FormLeg
        label="From"
        chains={swappableChains}
        chain={flow.srcChain}
        chainLabel="Network to send from"
        onChainChange={flow.setSrcChain}
        tokens={flow.srcTokens}
        token={flow.srcToken}
        tokenLabel="Token to send"
        onTokenChange={flow.setSrcToken}
        amount={flow.amount}
        amountLabel="Amount to send"
        onAmountChange={flow.setAmount}
        emptyTokensLabel="No swap tokens"
      />

      <FlipButton onClick={flow.flipDirection} />

      <FormLeg
        label="To"
        chains={swappableChains}
        chain={flow.dstChain}
        chainLabel="Network to receive on"
        onChainChange={flow.setDstChain}
        tokens={flow.dstTokens}
        token={flow.dstToken}
        tokenLabel="Token to receive"
        onTokenChange={flow.setDstToken}
        amount={flow.quotedOutput}
        amountLabel="Amount to receive"
        emptyTokensLabel="No swap tokens"
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
