import { assetCountFor, chainsFor } from '../lib/chains';
import { FLOW_BLURB, type Flow } from '../lib/flows';

const COPY: Record<Flow, { verb: string; accent: string }> = {
  swap: { verb: 'Swap', accent: 'everywhere' },
  bridge: { verb: 'Bridge', accent: 'everywhere' },
};

/**
 * The `sodax.com/exchange` app-title lockup: a bold word, an accent word in Shrikhand, and the
 * reach of the flow underneath — both counts derived from the same lists the pickers offer.
 */
export function Lockup({ flow }: { flow: Flow }) {
  const { verb, accent } = COPY[flow];

  return (
    <div className="lockup">
      <h2 className="lockup-title">
        {verb} <em>{accent}</em>
      </h2>
      <p className="lockup-subtitle">
        Access {assetCountFor(flow)} assets across {chainsFor(flow).length} networks.
      </p>
      {/* The rail no longer has room beside it for what each flow actually does. */}
      <p className="lockup-blurb muted small">{FLOW_BLURB[flow]}</p>
    </div>
  );
}
