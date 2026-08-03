import { ChainKeys, useRequestTrustline, type IStellarWalletProvider } from '@sodax/dapp-kit';
import Button from '../Button';
import ErrorNote from '../ErrorNote';
import HashLink from '../HashLink';
import type { TrustlineOption } from '../../lib/stellarTokens';
import type { StageStatus } from '../../lib/journey';

export default function TrustlineStage({
  option,
  requiresTrustline,
  amountInput,
  amountStroops,
  onAmountChange,
  walletProvider,
  status,
  blocksSpokeWrites,
}: {
  option: TrustlineOption;
  requiresTrustline: boolean;
  amountInput: string;
  amountStroops: bigint | undefined;
  onAmountChange: (next: string) => void;
  walletProvider: IStellarWalletProvider | undefined;
  status: StageStatus;
  /** Blocks a real-mainnet write built from mock Horizon state. */
  blocksSpokeWrites: boolean;
}) {
  const trustline = useRequestTrustline();
  const { symbol } = option.token;

  if (!requiresTrustline) {
    return (
      <div className="rounded-md border border-success-border bg-success-surface px-3 py-2.5 text-sm">
        <p className="font-medium">No trustline needed for {symbol}.</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The token config exempts it — the exemption covers the native asset and legacy bnUSD. An activated account can
          receive it immediately, holding nothing.
        </p>
      </div>
    );
  }

  if (!option.trustline) {
    return (
      <ErrorNote
        guidance={`No trustline config is published for ${symbol}.`}
        message="spokeChainConfig[stellar].trustlineConfigs has no entry matching this token address."
      />
    );
  }

  const onRequest = () => {
    if (blocksSpokeWrites || !walletProvider || amountStroops === undefined) return;
    trustline.mutate({
      token: option.token.address,
      amount: amountStroops,
      srcChainKey: ChainKeys.STELLAR_MAINNET,
      walletProvider,
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {status === 'done'
          ? `This account already trusts ${symbol} for at least the amount below.`
          : 'A non-native asset needs a trustline before the account can hold it. The account pays for this itself.'}
      </p>

      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Amount to accommodate</span>
        <input
          value={amountInput}
          onChange={event => onAmountChange(event.target.value)}
          inputMode="decimal"
          placeholder="1"
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
        />
      </label>
      {amountStroops === undefined ? (
        <p className="text-xs text-warning">Enter an amount — the check cannot run without one.</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Parsed at 7 decimals (Stellar trustline limits always are, whatever the token’s own precision). The amount
          only sizes the <em>check</em> — <code>changeTrust</code> is submitted with no limit, i.e. the maximum.
        </p>
      )}

      {blocksSpokeWrites && (
        <p className="rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-xs">
          <strong>Disabled while mock Horizon is on.</strong> The account state above is fabricated, but the mock serves
          no Soroban RPC — so submitting would build a <code>changeTrust</code> from mock data and send it to real
          mainnet. Switch the lab off mock Horizon to use this.
        </p>
      )}

      {status !== 'done' && (
        <Button
          onClick={onRequest}
          disabled={
            blocksSpokeWrites ||
            status !== 'active' ||
            trustline.isPending ||
            !walletProvider ||
            amountStroops === undefined
          }
          className="w-full"
        >
          {trustline.isPending ? 'Requesting…' : `Add ${symbol} trustline`}
        </Button>
      )}

      {trustline.isSuccess && (
        <div className="space-y-1 rounded-md border border-success-border bg-success-surface px-3 py-2 text-sm">
          <p className="font-medium">Trustline established.</p>
          <HashLink value={trustline.data} kind="tx" full />
        </div>
      )}

      {trustline.isError && (
        <ErrorNote guidance="The trustline transaction failed." message={trustline.error.message} />
      )}
    </div>
  );
}
