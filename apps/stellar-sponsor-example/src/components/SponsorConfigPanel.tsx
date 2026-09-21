import { SPONSOR_CONFIG_TTL_MS, useSponsorConfig } from '@sodax/dapp-kit';
import Button from './Button';
import Card, { Row } from './Card';
import HashLink from './HashLink';
import { formatXlm, parseStroopString, shorten } from '../lib/format';

/** Must match the pre-wallet-prompt mainnet assertion in `buildSponsoredCreate`. */
const STELLAR_PUBLIC_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

export default function SponsorConfigPanel() {
  const { data, isLoading, error, isFetching, refetch } = useSponsorConfig();

  const refresh = (
    <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
      {isFetching ? 'Loading…' : 'Refresh'}
    </Button>
  );

  if (isLoading) {
    return (
      <Card title="Sponsor configuration">
        <p className="text-sm text-muted-foreground">Loading sponsor config…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Sponsor configuration" aside={refresh}>
        <p className="text-sm text-destructive">Sponsor config unavailable: {error.message}</p>
      </Card>
    );
  }

  if (!data) return null;

  const isPublicNetwork = data.networkPassphrase === STELLAR_PUBLIC_PASSPHRASE;

  // Guard `BigInt`: the wire schema accepts any string.
  const feeStroops = (value: string) => {
    const stroops = parseStroopString(value);
    return stroops === undefined ? `${value} (unparseable)` : `${value} (${formatXlm(stroops)} XLM)`;
  };

  return (
    <Card title="Sponsor configuration" aside={refresh}>
      {!isPublicNetwork && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
          Not the public network — activation will fail before any wallet prompt. The sponsoring service accepts only
          Stellar mainnet, and the SDK asserts it locally.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <Row
          label="Sponsor account"
          hint="read from the server, never hardcoded — that is what makes rotation a config change"
          value={<HashLink value={data.sponsorAccount} kind="account" />}
        />
        <Row
          label="Network"
          value={
            isPublicNetwork ? (
              'Stellar public'
            ) : (
              <span className="text-destructive">{shorten(data.networkPassphrase, 10)}</span>
            )
          }
        />
        <Row label="Min total fee" value={feeStroops(data.minTotalFeeStroops)} />
        <Row label="Max total fee" value={feeStroops(data.maxTotalFeeStroops)} />
        <Row label="Operation count" value={data.operationCount} />
        <Row label="Min per-op fee" value={feeStroops(data.minPerOperationFeeStroops)} />
        <Row label="Max per-op fee" value={feeStroops(data.maxPerOperationFeeStroops)} />
        <Row
          label="Recommended per-op fee"
          hint="pass verbatim to TransactionBuilder"
          value={feeStroops(data.recommendedPerOperationFeeStroops)}
        />
        <Row label="Max time bounds" value={`${data.maxTimeboundSeconds}s`} />
        <Row
          label="Starting balance"
          hint="0 by contract — this is why the account ends up with nothing spendable"
          value={data.requiredStartingBalance}
        />
      </dl>

      <p className="mt-3 text-[0.6875rem] text-muted-foreground">
        Within the {SPONSOR_CONFIG_TTL_MS / 1000}s TTL, Refresh is served from the SDK’s in-memory cache and makes no
        request. A hard refresh lives in the Test lab.
      </p>
    </Card>
  );
}
