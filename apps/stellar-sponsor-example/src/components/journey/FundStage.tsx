import { STELLAR_TRUSTLINE_MIN_XLM_STROOPS, type StellarAccountStatus } from '@sodax/dapp-kit';
import type { UseQueryResult } from '@tanstack/react-query';
import Button from '../Button';
import CopyButton from '../CopyButton';
import HashLink from '../HashLink';
import { formatXlmAmount, shortfall } from '../../lib/format';

export default function FundStage({
  address,
  status,
  onSelectNative,
}: {
  address: string;
  status: UseQueryResult<StellarAccountStatus, Error>;
  onSelectNative: () => void;
}) {
  const { data, isFetching, refetch } = status;
  // The live requirement tracks the network's base reserve; the constant is only the pre-read guess.
  const required = data?.trustlineMinXlmStroops ?? STELLAR_TRUSTLINE_MIN_XLM_STROOPS;
  const missing = data ? shortfall(required, data.availableBalanceStroops) : undefined;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        The account exists but holds no spendable XLM. A trustline costs the account a fee plus one base reserve, and it
        pays that itself — the sponsor covered the account entry, not its balance.
      </p>

      {data && (
        <dl className="grid grid-cols-3 gap-3 rounded-md border border-border px-3 py-2.5 text-center">
          <Figure label="Total" value={formatXlmAmount(data.nativeBalanceStroops)} />
          <Figure label="Spendable" value={formatXlmAmount(data.availableBalanceStroops)} />
          <Figure label="Still needed" value={formatXlmAmount(missing ?? 0n)} emphasis />
        </dl>
      )}

      <div className="space-y-1.5 rounded-md border border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">Send XLM to</p>
          <CopyButton value={address} />
        </div>
        <p className="font-mono text-xs break-all">{address}</p>
        <HashLink value={address} kind="account" />
      </div>

      <p className="text-xs text-muted-foreground">
        Send at least {formatXlmAmount(missing ?? required)} from any exchange or existing Stellar account. This stage
        advances on its own once the funds land.
      </p>

      <div className="flex items-center gap-2">
        {/* Manual refresh still works after browser background polling pauses. */}
        <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? 'Checking…' : 'Check now'}
        </Button>
        <button type="button" onClick={onSelectNative} className="text-xs text-primary underline underline-offset-2">
          Receiving XLM itself needs none of this — show me
        </button>
      </div>
    </div>
  );
}

function Figure({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="contents">
      <div>
        <dt className="text-[0.6875rem] text-muted-foreground">{label}</dt>
        <dd className={`font-mono text-xs ${emphasis ? 'font-medium text-warning' : ''}`}>{value}</dd>
      </div>
    </div>
  );
}
