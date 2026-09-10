import { useCallback, useSyncExternalStore } from 'react';

export type ViewId = 'showcase' | 'lab';

const VIEW_IDS = ['showcase', 'lab'] as const satisfies readonly ViewId[];

const DEFAULT_VIEW: ViewId = 'showcase';

function isViewId(value: string): value is ViewId {
  return (VIEW_IDS as readonly string[]).includes(value);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function readHash(): ViewId {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  return isViewId(raw) ? raw : DEFAULT_VIEW;
}

function serverSnapshot(): ViewId {
  return DEFAULT_VIEW;
}

/** `useSyncExternalStore` keeps deep links correct through StrictMode and first paint. */
export function useHashView(): { view: ViewId; setView: (next: ViewId) => void } {
  const view = useSyncExternalStore(subscribe, readHash, serverSnapshot);

  const setView = useCallback((next: ViewId) => {
    const [, query] = window.location.hash.split('?');
    window.location.hash = query ? `#/${next}?${query}` : `#/${next}`;
  }, []);

  return { view, setView };
}

export function normalizeHash(): void {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  if (raw !== '' && !isViewId(raw)) {
    window.location.replace(`${window.location.pathname}${window.location.search}#/${DEFAULT_VIEW}`);
  }
}

export const VIEW_LABELS: Record<ViewId, string> = {
  showcase: 'Showcase',
  lab: 'Test lab',
};
