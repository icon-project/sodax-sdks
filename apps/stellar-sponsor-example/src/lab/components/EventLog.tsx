import { useState } from 'react';
import Button from '../../components/Button';
import Card from '../../components/Card';
import CopyButton from '../../components/CopyButton';
import { useLab, useLabLog } from '../LabContext';
import type { LabLogEntry, LabLogKind } from '../log';

const KIND_STYLES: Record<LabLogKind, string> = {
  analytics: 'text-muted-foreground',
  mutationError: 'text-destructive',
  signaturePrompt: 'text-warning',
  result: 'text-foreground',
  classification: 'text-primary',
  control: 'text-muted-foreground',
  note: 'text-muted-foreground',
};

export default function EventLog() {
  const { log } = useLab();
  const entries = useLabLog();
  const [expanded, setExpanded] = useState<string | undefined>(undefined);

  return (
    <Card
      title="Event log"
      aside={
        <div className="flex gap-1.5">
          <CopyButton value={JSON.stringify(entries, null, 2)} label="Copy diagnostics" />
          <Button variant="ghost" size="sm" onClick={log.clear} disabled={entries.length === 0}>
            Clear
          </Button>
        </div>
      }
    >
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing yet. Analytics gives the timeline, <code>onMutationError</code> gives the evidence, and the runner
          logs each classification beside its raw result.
        </p>
      ) : (
        <ul className="max-h-96 divide-y divide-border overflow-y-auto">
          {entries.map(entry => (
            <LogRow
              key={entry.id}
              entry={entry}
              open={expanded === entry.id}
              onToggle={() => setExpanded(current => (current === entry.id ? undefined : entry.id))}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function LogRow({ entry, open, onToggle }: { entry: LabLogEntry; open: boolean; onToggle: () => void }) {
  const time = new Date(entry.at).toISOString().slice(11, 23);
  const hasDetail = entry.detail !== undefined;

  return (
    <li className="py-1.5">
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasDetail}
        className="flex w-full items-baseline gap-2 text-left"
      >
        <span className="shrink-0 font-mono text-[0.625rem] text-muted-foreground">{time}</span>
        <span className="shrink-0 rounded bg-muted px-1 text-[0.625rem] text-muted-foreground">{entry.kind}</span>
        <span className={`min-w-0 flex-1 truncate text-xs ${KIND_STYLES[entry.kind]}`}>{entry.label}</span>
        {hasDetail && <span className="shrink-0 text-[0.625rem] text-muted-foreground">{open ? '▾' : '▸'}</span>}
      </button>
      {open && hasDetail && (
        <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted px-2 py-1.5 font-mono text-[0.625rem] leading-snug">
          {JSON.stringify(entry.detail, null, 2)}
        </pre>
      )}
    </li>
  );
}
