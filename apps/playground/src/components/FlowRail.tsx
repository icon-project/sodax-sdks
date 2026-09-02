import { FLOWS, FLOW_LABEL, type Flow } from '../lib/flows';

/** The glyph the exchange rail puts before each entry — direction for a swap, onward for a bridge. */
const GLYPH: Record<Flow, string> = {
  swap: '↕',
  bridge: '»',
};

/**
 * Names the flow the form is driving, as the left rail `sodax.com/exchange` uses. Two entries is not
 * the whole SDK — it is the smallest honest statement that SODAX is more than one operation.
 */
export function FlowRail({ flow, onChange }: { flow: Flow; onChange: (next: Flow) => void }) {
  return (
    <nav className="flow-rail" aria-label="SDK flow">
      <ul>
        {FLOWS.map(key => (
          <li key={key}>
            <button
              type="button"
              aria-current={key === flow ? 'page' : undefined}
              className={key === flow ? 'rail-item rail-item-active' : 'rail-item'}
              onClick={() => onChange(key)}
            >
              <span className="rail-glyph" aria-hidden="true">
                {GLYPH[key]}
              </span>
              {FLOW_LABEL[key]}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
