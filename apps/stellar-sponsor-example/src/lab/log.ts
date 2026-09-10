import type { AnalyticsConfig, AnalyticsEvent } from '@sodax/types';

export type LabLogKind =
  | 'analytics'
  | 'mutationError'
  | 'signaturePrompt'
  | 'result'
  | 'classification'
  | 'control'
  | 'note';

export type LabLogEntry = {
  id: string;
  at: number;
  kind: LabLogKind;
  label: string;
  scenario?: string;
  elapsedMs?: number;
  detail?: unknown;
};

const MAX_ENTRIES = 400;

const REDACTED = '«redacted»';

/** Never log credentials. */
const SENSITIVE_HEADERS = new Set(['x-api-key', 'authorization', 'cookie']);

export function toSerializable(value: unknown, depth = 0): unknown {
  if (depth > 8) return '«too deep»';
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' ? '«function»' : value;
  }
  if (value instanceof Error) {
    const base: Record<string, unknown> = { name: value.name, message: value.message };
    // Structural access survives duplicate SDK bundles where `instanceof` fails.
    for (const key of ['code', 'feature', 'context'] as const) {
      const extra = (value as unknown as Record<string, unknown>)[key];
      if (extra !== undefined) base[key] = toSerializable(extra, depth + 1);
    }
    if (value.cause !== undefined) base.cause = toSerializable(value.cause, depth + 1);
    return base;
  }
  if (Array.isArray(value)) return value.map(item => toSerializable(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? REDACTED : toSerializable(entry, depth + 1);
  }
  return out;
}

export type LabLogStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => readonly LabLogEntry[];
  append: (entry: Omit<LabLogEntry, 'id' | 'at'>) => void;
  clear: () => void;
};

/** Lives outside React Query so target/cache changes do not erase diagnostics. */
export function createLabLogStore(): LabLogStore {
  let entries: readonly LabLogEntry[] = [];
  let sequence = 0;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return entries;
    },
    append(entry) {
      sequence += 1;
      const next: LabLogEntry = { ...entry, id: `e${sequence}`, at: Date.now() };
      entries = [next, ...entries].slice(0, MAX_ENTRIES);
      emit();
    },
    clear() {
      entries = [];
      emit();
    },
  };
}

export function createLabAnalytics(store: LabLogStore): AnalyticsConfig {
  return {
    level: 'detailed',
    features: { sponsoring: true },
    tracker: (event: AnalyticsEvent) => {
      store.append({
        kind: 'analytics',
        label: `${event.feature}.${event.action}:${event.phase}`,
        detail: event.data ? toSerializable(event.data) : undefined,
      });
    },
  };
}
