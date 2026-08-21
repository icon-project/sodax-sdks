import {
  useActivateStellarAccount,
  type ActivateStellarAccountResult,
  type IStellarWalletProvider,
} from '@sodax/dapp-kit';
import { useState } from 'react';
import Button from '../Button';
import ErrorNote from '../ErrorNote';
import HashLink from '../HashLink';
import { describeError } from '../../lib/sponsorErrors';
import type { StageStatus } from '../../lib/journey';

/**
 * The new account authorizes sponsorship with its signature; the server adds
 * the sponsor signature and submits.
 */
export default function ActivateStage({
  address,
  walletProvider,
  status,
  onActivated,
}: {
  address: string;
  walletProvider: IStellarWalletProvider | undefined;
  status: StageStatus;
  /** Persist the result after status invalidation unmounts this stage. */
  onActivated: (result: ActivateStellarAccountResult) => void;
}) {
  // Explain a second signature before the wallet extension takes focus.
  const [resignNotice, setResignNotice] = useState(false);
  const activate = useActivateStellarAccount({ mutationOptions: { onSuccess: onActivated } });

  const onActivate = () => {
    if (!walletProvider) return;
    setResignNotice(false);
    activate.mutate({
      address,
      walletProvider,
      onSignatureRequired: info => setResignNotice(info.reason === 'sequenceConflict'),
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {status === 'done'
          ? 'This account exists on-chain. It can receive — but a sponsored activation deliberately leaves it holding zero XLM, so it cannot yet pay for anything itself.'
          : status === 'unknown'
            ? 'Checking whether this account exists on-chain.'
            : 'Not activated. A Stellar account must exist on-chain before it can hold or receive anything. The sponsor pays its base reserve; you only sign.'}
      </p>

      {status !== 'done' && (
        <Button
          onClick={onActivate}
          disabled={status !== 'active' || activate.isPending || !walletProvider}
          className="w-full"
        >
          {activate.isPending ? 'Activating…' : 'Activate account'}
        </Button>
      )}

      {resignNotice && activate.isPending && (
        <p className="rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-sm">
          Another activation used the sponsor’s slot first, so the transaction had to be rebuilt.{' '}
          <strong>Please approve the second signature in your wallet.</strong>
        </p>
      )}

      {activate.isSuccess &&
        (activate.data.status === 'submitted' ? (
          <div className="space-y-1 rounded-md border border-success-border bg-success-surface px-3 py-2 text-sm">
            <p className="font-medium">Account activated.</p>
            <HashLink value={activate.data.hash} kind="tx" full />
            {activate.data.attempts === 2 && (
              <p className="text-xs text-muted-foreground">
                Took two signatures because of a sponsor sequence conflict.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-success-border bg-success-surface px-3 py-2 text-sm">
            <p className="font-medium">Already active.</p>
            <p className="text-xs text-muted-foreground">
              {activate.data.attempts === 0
                ? 'Detected before signing, so no wallet prompt was needed.'
                : 'Another activation landed first — nothing was submitted.'}
            </p>
          </div>
        ))}

      {activate.isError && <ErrorNote {...describeError(activate.error)} />}

      {status === 'active' && !walletProvider && (
        <p className="text-xs text-muted-foreground">Waiting for the wallet provider to hydrate…</p>
      )}
    </div>
  );
}
