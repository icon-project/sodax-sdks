import type { StellarAccountStatus } from '@sodax/dapp-kit';
import type { UseQueryResult } from '@tanstack/react-query';
import Button from '../Button';
import Card, { Row } from '../Card';
import HashLink from '../HashLink';
import { formatXlmAmount } from '../../lib/format';

export default function AccountFactsCard({
  address,
  statusCheck,
}: {
  address: string;
  statusCheck: UseQueryResult<StellarAccountStatus, Error>;
}) {
  const { data, isFetching, isError, error, refetch } = statusCheck;

  return (
    <Card
      title="Account"
      aside={
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? 'Reading…' : 'Refresh'}
        </Button>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <Row label="Address" value={<HashLink value={address} kind="account" />} />
        {isError ? (
          // A transient Horizon failure must not be reported as an inactive account.
          <Row label="State" value={<span className="text-destructive">unreadable</span>} />
        ) : !data ? (
          <Row label="State" value="checking…" />
        ) : (
          <>
            <Row label="Exists" value={data.exists ? 'yes' : 'no'} />
            <Row label="Total balance" value={formatXlmAmount(data.nativeBalanceStroops)} />
            <Row
              label="Spendable"
              hint="total minus locked reserve and selling liabilities"
              value={formatXlmAmount(data.availableBalanceStroops)}
            />
            <Row
              label="Trustline threshold"
              hint="one base reserve plus the fee this account must pay"
              value={formatXlmAmount(data.trustlineMinXlmStroops)}
            />
            <Row
              label="Can afford one"
              value={
                <span className={data.canAffordTrustline ? 'text-success' : 'text-muted-foreground'}>
                  {data.canAffordTrustline ? 'yes' : 'no'}
                </span>
              }
            />
          </>
        )}
      </dl>
      {isError && error && <p className="mt-2 text-xs text-destructive">Couldn’t read the account: {error.message}</p>}
    </Card>
  );
}
