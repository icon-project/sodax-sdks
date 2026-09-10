import type { ActivateStellarAccountResult } from '@sodax/dapp-kit';
import Card from '../Card';
import HashLink from '../HashLink';

/** Lives outside the unmounted stage so the mainnet transaction receipt persists. */
export default function ActivationReceipt({ result }: { result: ActivateStellarAccountResult }) {
  return (
    <Card title="Activation result">
      {result.status === 'submitted' ? (
        <div className="space-y-1 text-sm">
          <p className="font-medium">Account activated.</p>
          <HashLink value={result.hash} kind="tx" full />
          {result.attempts === 2 && (
            <p className="text-xs text-muted-foreground">Took two signatures because of a sponsor sequence conflict.</p>
          )}
        </div>
      ) : (
        <div className="text-sm">
          <p className="font-medium">Already active.</p>
          <p className="text-xs text-muted-foreground">
            {result.attempts === 0
              ? 'Detected before signing, so no wallet prompt was needed.'
              : 'Another activation landed first — nothing was submitted.'}
          </p>
        </div>
      )}
    </Card>
  );
}
