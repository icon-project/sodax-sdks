import { EXCHANGE_URL } from '../config';
import type { SwapFlow } from '../hooks/useSwapFlow';
import type { TokenChoice } from '../lib/chains';
import { WalletControls } from './WalletControls';
import { SwapReview } from './SwapReview';
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

function PrimaryAction({ flow }: { flow: SwapFlow }) {
  const e = flow.execution;
  const disabled = (text: string) => (
    <button type="button" className="btn btn-primary" disabled>
      {text}
    </button>
  );
  if (e.activity) return disabled(e.terminal ? 'See your latest swap below' : 'Swap in progress');
  if (!flow.srcToken || !flow.dstToken) return disabled('Choose assets');
  if (!flow.isAmountValid) return disabled('Enter an amount');
  if (!flow.isSlippageValid) return disabled('Check slippage');
  if (flow.partnerFeeError) return disabled('Configuration needs attention');
  if (!e.signable)
    return (
      <a className="btn btn-primary" href={EXCHANGE_URL} target="_blank" rel="noreferrer" onClick={flow.trackHandoff}>
        Continue on SODAX ↗
      </a>
    );
  if (!e.source?.address)
    return (
      <button type="button" className="btn btn-primary" onClick={() => e.openConnect(e.sourceType)}>
        Connect wallet
      </button>
    );
  if (!e.destination?.address)
    return (
      <button type="button" className="btn btn-primary" onClick={() => e.openConnect(e.destinationType)}>
        Connect receiving wallet
      </button>
    );
  if (e.isWrongChain)
    return (
      <button type="button" className="btn btn-primary" onClick={e.handleSwitchChain}>
        Switch network in wallet
      </button>
    );
  if (e.insufficientBalance) return disabled('Insufficient balance');
  if (flow.quoteError)
    return (
      <button type="button" className="btn btn-primary" onClick={flow.refreshQuote}>
        Retry quote
      </button>
    );
  if (flow.hasQuote && Number(flow.minReceived) <= 0) return disabled('Amount too small');
  if (!flow.hasQuote) return disabled(flow.isQuoting ? 'Finding a quote…' : 'Enter an amount');
  return (
    <button type="button" className="btn btn-primary" onClick={e.openReview}>
      Review swap
    </button>
  );
}

function LoadingForm({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <section className="card swap-card">
      <div className="asset-panel asset-panel-skeleton" aria-hidden="true" />
      <FlipButton onClick={() => {}} />
      <div className="asset-panel asset-panel-skeleton" aria-hidden="true" />
      <p className="muted small" role="status">
        {message}
      </p>
      {retry && (
        <button type="button" className="btn" onClick={retry}>
          Retry loading assets
        </button>
      )}
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

  if (flow.assetsError) return <LoadingForm message={flow.assetsError} retry={flow.retryAssets} />;
  if (!srcChain || !dstChain)
    return (
      <LoadingForm
        message={flow.isLoadingAssets ? 'Loading assets…' : 'No assets available for the configured networks.'}
        retry={flow.retryAssets}
      />
    );

  // One slot, so a fee error and a quote error cannot stack and resize the card between them.
  // The tail stays short enough to hold one line: "this pair" already says to try another.
  const message = flow.partnerFeeError ?? flow.quoteError;

  return (
    <>
      <WalletControls execution={flow.execution} />
      <section className="card swap-card">
        <fieldset className="swap-fields" disabled={!!flow.execution.phase || !!flow.execution.activity}>
          <div className="row-between asset-caption">
            <span>You pay</span>
            {flow.execution.balanceText !== undefined && (
              <span>
                Balance: {formatTokenAmount(flow.execution.balanceText)}
                {flow.execution.canMax && (
                  <button
                    className="btn max-button"
                    type="button"
                    onClick={() => flow.setAmount(flow.execution.balanceText ?? '')}
                  >
                    MAX
                  </button>
                )}
              </span>
            )}
          </div>
          <AssetPanel
            symbol={flow.srcToken?.symbol}
            chain={srcChain}
            emptyLabel="No assets"
            pickerLabel="Asset to send"
            picker={state => (
              <AssetPicker
                {...state}
                groups={flow.sourceGroups}
                networks={flow.sourceNetworks}
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
                groups={flow.destinationGroups}
                networks={flow.destinationNetworks}
                selected={flow.dstToken && { chain: dstChain, symbol: flow.dstToken.symbol }}
                onSelect={selectDst}
              />
            )}
            amount={flow.quotedOutput}
            amountLabel="Amount to receive"
            note={flow.hasQuote ? (flow.isQuoting ? 'refreshing…' : 'Live quote') : undefined}
          />
        </fieldset>
        <details className="disclosure swap-details">
          <summary>Swap details &amp; settings</summary>
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
                <span className="muted">Partner fee ({flow.partnerFee.percentage / 100}%)</span>
                <Amount value={flow.partnerFeeAmount} symbol={flow.srcToken?.symbol} />
              </div>
            )}
            <div className="row-between">
              <span className="muted">Minimum received</span>
              <Amount value={flow.minReceived} symbol={flow.dstToken?.symbol} />
            </div>
            {flow.speedTier && (
              <div className="row-between">
                <span className="muted">Estimated time</span>
                <span>~{flow.speedTier.estimatedSeconds}s</span>
              </div>
            )}
          </div>
        </details>
        {flow.execution.balanceError && (
          <p className="muted small">Balance unavailable. Check your balance and network fees in your wallet.</p>
        )}

        <div className="action-dock">
          <PrimaryAction flow={flow} />
          {/* Reserve space so quote errors do not move the action. */}
          <div className="action-message" role="status" aria-live="polite">
            {message && <p className="alert">{message}</p>}
          </div>
          <p className="muted small action-note">
            {flow.execution.signable
              ? 'Powered by SODAX · Your keys stay in your wallet.'
              : 'Quote-only for this route. Continue on SODAX and select your trade there.'}
          </p>
        </div>
      </section>
      <SwapReview flow={flow} />
    </>
  );
}
