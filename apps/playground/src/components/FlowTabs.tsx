import { FLOWS, FLOW_BLURB, FLOW_LABEL, type Flow } from '../lib/flows';

/**
 * Names the flow the form is driving. Two tabs is not the whole SDK — it is the smallest honest
 * statement that SODAX is more than one operation, and that each one is its own set of hooks.
 */
export function FlowTabs({ flow, onChange }: { flow: Flow; onChange: (next: Flow) => void }) {
  return (
    <div className="flow-tabs">
      <div className="tabs" role="tablist" aria-label="SDK flow">
        {FLOWS.map(key => (
          <button
            type="button"
            key={key}
            role="tab"
            aria-selected={key === flow}
            className={key === flow ? 'tab tab-active' : 'tab'}
            onClick={() => onChange(key)}
          >
            {FLOW_LABEL[key]}
          </button>
        ))}
      </div>
      <p className="muted small flow-blurb">{FLOW_BLURB[flow]}</p>
    </div>
  );
}
