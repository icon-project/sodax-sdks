import { STAGE_ORDER, STAGE_TITLES, type JourneyStages, type StageStatus } from '../../lib/journey';

const NODE: Record<StageStatus, string> = {
  done: 'border-success bg-success text-white',
  active: 'border-primary bg-primary text-primary-foreground ring-4 ring-ring/20',
  pending: 'border-border bg-background text-muted-foreground',
  // Dashed, never styled as `pending`: "we do not know" and "not your turn" are different claims.
  unknown: 'border-dashed border-muted-foreground/50 bg-background text-muted-foreground',
  skipped: 'border-border bg-muted text-muted-foreground',
};

const LABEL: Record<StageStatus, string> = {
  done: 'text-muted-foreground',
  active: 'font-medium text-foreground',
  pending: 'text-muted-foreground',
  unknown: 'text-muted-foreground',
  skipped: 'text-muted-foreground line-through decoration-muted-foreground/50',
};

const CAPTION: Partial<Record<StageStatus, string>> = {
  unknown: 'checking…',
  skipped: 'not needed',
  done: 'done',
};

export default function StageProgress({ stages }: { stages: JourneyStages }) {
  return (
    <ol className="flex items-start gap-2">
      {STAGE_ORDER.map((stage, index) => {
        const status = stages[stage];
        const caption = CAPTION[status];
        return (
          <li
            key={stage}
            className="flex flex-1 items-start gap-2"
            aria-current={status === 'active' ? 'step' : undefined}
          >
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${NODE[status]}`}
              >
                {status === 'done' ? '✓' : status === 'skipped' ? '–' : index + 1}
              </span>
            </div>
            <div className="min-w-0 pt-0.5">
              <p className={`text-xs leading-tight ${LABEL[status]}`}>{STAGE_TITLES[stage]}</p>
              {caption && <p className="text-[0.6875rem] text-muted-foreground/80">{caption}</p>}
            </div>
            {index < STAGE_ORDER.length - 1 && (
              <span aria-hidden className="mt-3.5 hidden h-px flex-1 bg-border sm:block" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
