import type { Execution } from '../hooks/useExecution';
import { txExplorerUrl } from '../lib/chains';
import { PHASE_LABELS } from './SwapReview';

export function SwapActivity({ execution: e }: { execution: Execution }) {
  const activity = e.activity;
  if (!activity) return null;
  const solved = e.status?.status === 'solved';
  const failed = e.status?.status === 'failed' || !!e.status?.abandonedAt;
  return (
    <section className="activity-card card" aria-label="Latest swap">
      <p className="eyebrow">Latest swap</p>
      <h3>{solved ? 'Swap complete' : failed ? 'Swap needs attention' : 'Swap in progress'}</h3>
      <p>{activity.summary}</p>
      <p className="muted small" role="status">
        {e.phase
          ? PHASE_LABELS[e.phase]
          : solved
            ? 'Your destination transfer is complete.'
            : failed
              ? (e.status?.userMessage ??
                'Check the transaction and contact support for recovery. Do not repeat this swap.')
              : e.statusError
                ? 'Tracking is temporarily unavailable. Your transaction may still be processing.'
                : 'Waiting for cross-chain settlement. You can keep tracking here.'}
      </p>
      <div className="activity-links">
        <a
          className="link"
          href={txExplorerUrl(activity.srcChainKey, activity.txHash)}
          target="_blank"
          rel="noreferrer"
        >
          Source transaction ↗
        </a>
        {e.status?.result?.fillTxHash && (
          <a
            className="link"
            href={txExplorerUrl(activity.dstChainKey, e.status.result.fillTxHash)}
            target="_blank"
            rel="noreferrer"
          >
            Destination transaction ↗
          </a>
        )}
      </div>
      <details className="disclosure">
        <summary>Transaction details</summary>
        <p className="address-text small">{activity.txHash}</p>
        <p className="muted small">Receiving wallet</p>
        <p className="address-text small">{activity.recipient}</p>
      </details>
      {!e.storageAvailable && (
        <p className="alert">
          This browser blocked saving progress. Keep this page open and save the transaction hash.
        </p>
      )}
      {e.error && (
        <p className="alert" role="alert">
          {e.error}
        </p>
      )}
      <div className="activity-links">
        {!e.terminal && (
          <button className="btn" type="button" disabled={!!e.phase} onClick={e.retrySubmission}>
            Retry tracking
          </button>
        )}
        {failed && (
          <a className="btn" href="https://support.sodax.com" target="_blank" rel="noreferrer">
            SODAX support ↗
          </a>
        )}
        {e.terminal && (
          <button className="btn" type="button" onClick={e.clearActivity}>
            New swap
          </button>
        )}
      </div>
    </section>
  );
}
