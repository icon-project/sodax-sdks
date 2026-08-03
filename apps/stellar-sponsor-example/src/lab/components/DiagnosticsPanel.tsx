import {
  SPONSOR_CONFIG_TTL_MS,
  useSodaxContext,
  useStellarAccountActive,
  useStellarAccountStatus,
} from '@sodax/dapp-kit';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Button from '../../components/Button';
import Card, { Row } from '../../components/Card';
import { formatXlmAmount } from '../../lib/format';
import { useLab } from '../LabContext';
import { toSerializable } from '../log';

export default function DiagnosticsPanel({ address }: { address: string | undefined }) {
  const { sodax } = useSodaxContext();
  const { log } = useLab();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const active = useStellarAccountActive({ params: { address } });
  const status = useStellarAccountStatus({ params: { address } });

  const forceConfigRefresh = async () => {
    setRefreshing(true);
    const result = await sodax.sponsoring.getStellarSponsorConfig({ forceRefresh: true });
    if (result.ok) {
      queryClient.setQueryData(['sponsoring', 'sponsorConfig'], result.value);
      log.append({ kind: 'control', label: 'sponsor config force-refreshed', detail: toSerializable(result.value) });
    } else {
      log.append({ kind: 'control', label: 'force refresh failed', detail: toSerializable(result.error) });
    }
    setRefreshing(false);
  };

  return (
    <Card
      title="Account reads"
      aside={
        <Button variant="ghost" size="sm" onClick={forceConfigRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Force config refresh'}
        </Button>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <Row
          label="useStellarAccountActive"
          hint="boolean only — cannot tell you the account is broke"
          value={active.isLoading ? 'loading…' : active.isError ? 'error' : String(active.data)}
        />
        {status.data && (
          <>
            <Row label="status.exists" value={String(status.data.exists)} />
            <Row label="status.nativeBalance" value={formatXlmAmount(status.data.nativeBalanceStroops)} />
            <Row label="status.availableBalance" value={formatXlmAmount(status.data.availableBalanceStroops)} />
            <Row label="status.canAffordTrustline" value={String(status.data.canAffordTrustline)} />
          </>
        )}
        {status.isError && <Row label="status" value={<span className="text-destructive">threw</span>} />}
      </dl>
      <p className="mt-2 text-[0.6875rem] text-muted-foreground">
        Both throw rather than reporting "absent" when Horizon fails — a transient outage rendered as "your account does
        not exist" would push a user into a pointless activation. Sponsor config is cached for{' '}
        {SPONSOR_CONFIG_TTL_MS / 1000}s per base URL, which Force refresh bypasses.
      </p>
    </Card>
  );
}
