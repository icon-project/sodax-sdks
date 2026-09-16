import type { ChainKey, XToken } from '@sodax/dapp-kit';
import { formatUnits } from 'viem';
import type { Execution } from '../hooks/useExecution';
import type { SwapFlow } from '../hooks/useSwapFlow';
import { chainName } from '../lib/chains';
import { formatTokenAmount } from '../lib/format';
import { STATUS_LABELS, failureMessage, progressLabel, refundAccounted } from '../lib/progress';
import { AssetLogo } from './AssetLogo';
import { Chevron } from './Dropdown';
import { Modal } from './Modal';
import { shortAddress } from './WalletControls';

function Spinner() {
  return (
    <svg className="spinner" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <path
        d="M6 1.75A4.25 4.25 0 1 1 1.75 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TimerGlyph() {
  return (
    <svg className="review-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 1.5h4M8 6.5V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="9" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function DoneGlyph() {
  return (
    <svg className="review-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 3.5L7.5 8L3 12.5M9 3.5L13.5 8L9 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg className="copied-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** One side of the swap: the asset on its network, what it is worth, and whose wallet it moves in. */
function Leg({
  token,
  chain,
  amount,
  address,
  least = false,
  spent = false,
}: {
  token: XToken;
  chain: ChainKey;
  amount: string;
  address: string;
  /** The delivered amount is a floor, never a promise — the destination leg says so. */
  least?: boolean;
  spent?: boolean;
}) {
  return (
    <div className={spent ? 'review-leg review-leg-spent' : 'review-leg'}>
      <AssetLogo symbol={token.symbol} chain={chain} />
      <p className="review-leg-amount">
        {/* Reserved on both sides, empty or not, so the two amounts sit on one line. */}
        <span className="review-least muted">{least ? 'at least' : ''}</span>
        <span title={`${amount} ${token.symbol}`}>{formatTokenAmount(amount)}</span>{' '}
        <span className="muted">{token.symbol}</span>
      </p>
      <p className="review-leg-where">
        <span className="review-chip">{shortAddress(address)}</span>
        <span className="muted small">on {chainName(chain)}</span>
      </p>
    </div>
  );
}

/** One slot, one line: the failure first, then whatever makes tracking less than it looks. */
function reviewMessage(e: Execution): string | undefined {
  if (e.failed) return failureMessage(e.status);
  if (e.error) return e.error;
  if (!e.activity) return undefined;
  if (e.statusError) return 'Tracking is temporarily unavailable. Your transaction may still be processing.';
  if (!e.storageAvailable) return 'This browser blocked saving progress. Keep this page open until the swap settles.';
  return undefined;
}

function ConfirmAction({ flow, token, chain }: { flow: SwapFlow; token: XToken; chain: ChainKey }) {
  const e = flow.execution;

  if (e.solved)
    return (
      <button type="button" className="btn btn-primary" onClick={e.closeReview}>
        Swap complete <CheckGlyph />
      </button>
    );

  if (e.failed)
    return (
      <button type="button" className="btn btn-primary" onClick={e.closeReview}>
        Close
      </button>
    );

  // The relay rejected the submission but the deposit is broadcast: resubmit that same transaction,
  // never sign a second one.
  if (e.activity && e.error && !e.phase)
    return (
      <button type="button" className="btn btn-primary" onClick={e.retrySubmission}>
        Retry tracking
      </button>
    );

  const working = progressLabel(e.phase, e.status?.status) ?? (e.activity ? STATUS_LABELS.pending : undefined);
  if (working)
    return (
      <button type="button" className="btn btn-primary btn-working" disabled>
        {working} <Spinner />
      </button>
    );

  return (
    <button type="button" className="btn btn-primary" onClick={e.confirm}>
      Swap to {token.symbol} on {chainName(chain)}
    </button>
  );
}

/**
 * The exchange's confirm dialog: both legs, the one action that carries the whole lifecycle, and the
 * numbers behind a disclosure. It stays open from confirmation to settlement — closing it early is
 * what once left a visitor watching a card behind the form.
 */
export function SwapReview({ flow }: { flow: SwapFlow }) {
  const e = flow.execution;
  const review = e.review;
  const problem = reviewMessage(e);

  return (
    <Modal title="Confirm swap" open={!!review} onClose={e.closeReview} busy={!!e.phase} bare>
      {review && (
        <div className="review">
          {/* Always here, usually empty: a dialog mid-swap must not jump when a step reports back. */}
          <p className="review-message" role="alert">
            {problem}
          </p>
          <div className="review-legs">
            <Leg
              token={review.srcToken}
              chain={review.srcChain}
              amount={formatUnits(BigInt(review.intent.inputAmount), review.srcToken.decimals)}
              address={review.intent.srcAddress}
              spent={e.solved}
            />
            <div className="review-eta">
              {e.solved ? <DoneGlyph /> : <TimerGlyph />}
              <span className="muted small">
                {e.solved ? 'Done' : review.estimatedSeconds && `~${review.estimatedSeconds}s`}
              </span>
            </div>
            <Leg
              token={review.dstToken}
              chain={review.dstChain}
              amount={formatUnits(BigInt(review.intent.minOutputAmount), review.dstToken.decimals)}
              address={review.intent.dstAddress}
              least
            />
          </div>
          <p className="review-recipient small">
            <span className="muted">Receiving wallet</span>
            <span className="address-text">{review.intent.dstAddress}</span>
          </p>
          <ConfirmAction flow={flow} token={review.dstToken} chain={review.dstChain} />
          {/* Offered only while the funds are unaccounted for: beside "your funds are back" it
              invents a problem, and a partner's frame sends their customer on as rarely as it can. */}
          {e.failed && !refundAccounted(e.status) && (
            <a className="link review-support" href="https://support.sodax.com" target="_blank" rel="noreferrer">
              SODAX support ↗
            </a>
          )}
          {!e.activity && (
            <details className="review-fees">
              <summary>
                {flow.partnerFee
                  ? `Total fees: ${formatTokenAmount(flow.partnerFeeAmount)} ${review.srcToken.symbol}`
                  : 'Swap details'}
                <Chevron up={false} className="review-chevron" />
              </summary>
              <div className="review-fees-rows">
                {flow.partnerFee && (
                  <div className="row-between">
                    <span className="muted">Swap fee ({flow.partnerFee.percentage / 100}%)</span>
                    <span>
                      {formatTokenAmount(flow.partnerFeeAmount)} {review.srcToken.symbol}
                    </span>
                  </div>
                )}
                <div className="row-between">
                  <span className="muted">Network fees</span>
                  <span>Confirmed in your wallet</span>
                </div>
                <div className="row-between">
                  <span className="muted">Via</span>
                  <span>SODAX API</span>
                </div>
              </div>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}
