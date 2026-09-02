import { STELLAR_TRUSTLINE_MIN_XLM_STROOPS, type StellarAccountStatus } from '@sodax/dapp-kit';
import Button from '../Button';
import { formatXlmAmount } from '../../lib/format';

export default function ReadyCard({
  symbol,
  isNative,
  status,
  onReset,
}: {
  symbol: string;
  isNative: boolean;
  status: StellarAccountStatus | undefined;
  onReset: () => void;
}) {
  return (
    <div className="space-y-3 rounded-md border border-success-border bg-success-surface px-4 py-3">
      <p className="text-sm font-medium">Ready — this account can hold and receive {symbol}.</p>

      {isNative ? (
        <p className="text-xs text-muted-foreground">
          XLM needs no trustline, so the account is usable the moment it exists. Receiving some is what unlocks every
          other asset.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Adding another asset needs a further{' '}
          {formatXlmAmount(status?.trustlineMinXlmStroops ?? STELLAR_TRUSTLINE_MIN_XLM_STROOPS)} of{' '}
          <strong>spendable</strong> balance — the trustline you just created locks one base reserve, so the account’s
          total balance now overstates what it can actually spend.
          {status && (
            <>
              {' '}
              Currently {formatXlmAmount(status.nativeBalanceStroops)} total,{' '}
              {formatXlmAmount(status.availableBalanceStroops)} spendable.
            </>
          )}
        </p>
      )}

      <Button variant="secondary" size="sm" onClick={onReset}>
        Try another token
      </Button>
    </div>
  );
}
