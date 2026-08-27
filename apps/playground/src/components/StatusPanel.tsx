import { SolverIntentStatusCode } from '@sodax/dapp-kit';
import type { Delivery } from '../hooks/useSwapFlow';
import { chainName, txExplorerUrl } from '../lib/chains';

function statusLabel(code: SolverIntentStatusCode | undefined): string {
  switch (code) {
    case SolverIntentStatusCode.SOLVED:
      return 'Settled';
    case SolverIntentStatusCode.FAILED:
      return 'Failed';
    case SolverIntentStatusCode.NOT_FOUND:
      return 'Waiting for the solver to pick it up…';
    case undefined:
      return 'Submitting…';
    default:
      return 'In progress…';
  }
}

function statusTone(code: SolverIntentStatusCode | undefined): string {
  if (code === SolverIntentStatusCode.SOLVED) return 'status-ok';
  if (code === SolverIntentStatusCode.FAILED) return 'status-bad';
  return 'status-pending';
}

function shortenHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

export function StatusPanel({
  delivery,
  statusCode,
}: {
  delivery: Delivery;
  statusCode: SolverIntentStatusCode | undefined;
}) {
  return (
    <div className="status-panel">
      <div className="row-between">
        <span className="muted">Status</span>
        <strong className={statusTone(statusCode)}>{statusLabel(statusCode)}</strong>
      </div>
      <div className="row-between">
        <span className="muted">Source tx</span>
        <a
          className="mono link"
          href={txExplorerUrl(delivery.srcChainKey, delivery.srcTxHash)}
          target="_blank"
          rel="noreferrer"
        >
          {shortenHash(delivery.srcTxHash)} ↗
        </a>
      </div>
      <p className="muted small">
        Submitted on {chainName(delivery.srcChainKey)}. SODAX routes and settles the intent; admitted solvers compete to
        fill it.
      </p>
    </div>
  );
}
