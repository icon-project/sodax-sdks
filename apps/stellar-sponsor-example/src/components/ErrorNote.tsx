export type ErrorNoteProps = {
  guidance: string;
  message: string;
  nextAction?: string;
};

export default function ErrorNote({ guidance, message, nextAction }: ErrorNoteProps) {
  return (
    <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-destructive">{guidance}</p>
        {nextAction && (
          <code className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[0.6875rem] text-destructive">
            {nextAction}
          </code>
        )}
      </div>
      <p className="font-mono text-xs break-all text-muted-foreground">{message}</p>
    </div>
  );
}
