import { formatUnits } from 'viem';
import type { SwapFlow } from '../hooks/useSwapFlow';
import { chainName } from '../lib/chains';
import { formatTokenAmount } from '../lib/format';
import { Modal } from './Modal';

export const PHASE_LABELS = {
  checking: 'Checking the latest quote…',
  approving: 'Approve the token in your wallet…',
  building: 'Preparing your swap…',
  signing: 'Confirm the swap in your wallet…',
  submitting: 'Tracking your transaction…',
};

export function SwapReview({ flow }: { flow: SwapFlow }) {
  const e = flow.execution;
  const review = e.review;
  return (
    <Modal title="Review swap" open={!!review} onClose={e.closeReview} busy={!!e.phase}>
      {review && flow.srcChain && flow.dstChain && flow.srcToken && flow.dstToken && (
        <div className="modal-body">
          <p className="review-amount">
            {formatTokenAmount(formatUnits(BigInt(review.inputAmount), flow.srcToken.decimals))} {flow.srcToken.symbol}
            <span className="muted"> → {flow.dstToken.symbol}</span>
          </p>
          <dl className="review-details">
            <dt>From</dt>
            <dd>{chainName(flow.srcChain)}</dd>
            <dt>To</dt>
            <dd>{chainName(flow.dstChain)}</dd>
            <dt>Minimum received</dt>
            <dd>
              {formatTokenAmount(formatUnits(BigInt(review.minOutputAmount), flow.dstToken.decimals))}{' '}
              {flow.dstToken.symbol}
            </dd>
            <dt>Network fees</dt>
            <dd>Shown by your wallet before signing</dd>
            {review.partnerFee && 'percentage' in review.partnerFee && (
              <>
                <dt>Partner fee</dt>
                <dd>{review.partnerFee.percentage / 100}% (included in quote)</dd>
              </>
            )}
          </dl>
          <div className="recipient-box">
            <span className="muted small">Receiving wallet</span>
            <p className="address-text">{review.dstAddress}</p>
          </div>
          <p className="muted small">
            This is a mainnet swap using real funds. Check the receiving wallet and minimum amount before confirming.
          </p>
          {e.error && (
            <p className="alert" role="alert">
              {e.error}
            </p>
          )}
          <button type="button" className="btn btn-primary" disabled={!!e.phase} onClick={e.confirm}>
            {e.phase ? PHASE_LABELS[e.phase] : 'Confirm swap'}
          </button>
        </div>
      )}
    </Modal>
  );
}
