import type { ReactNode } from 'react';

export type CardProps = {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
};

export default function Card({ title, aside, children, className = '' }: CardProps) {
  return (
    <section className={`rounded-lg border border-border bg-card p-5 ${className}`}>
      {(title || aside) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          {title && <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>}
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function Row({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">
        {label}
        {hint && <p className="mt-0.5 text-[0.6875rem] leading-snug opacity-80">{hint}</p>}
      </dt>
      <dd className="text-right font-mono break-all">{value}</dd>
    </div>
  );
}
