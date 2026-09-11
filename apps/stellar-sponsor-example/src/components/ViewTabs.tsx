import { VIEW_LABELS, type ViewId } from '../lib/useHashView';

const VIEWS: readonly ViewId[] = ['showcase', 'lab'];

const TAB_BASE = 'border-b-2 px-1 pb-2 text-sm transition-colors';

export default function ViewTabs({
  view,
  setView,
  hiddenViews = [],
}: {
  view: ViewId;
  setView: (next: ViewId) => void;
  hiddenViews?: readonly ViewId[];
}) {
  const visible = VIEWS.filter(id => !hiddenViews.includes(id));
  if (visible.length < 2) return null;

  return (
    <div className="flex gap-6 border-b border-border px-6" role="tablist" aria-label="Views">
      {visible.map(id => {
        const active = id === view;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setView(id)}
            className={`${TAB_BASE} ${
              active
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {VIEW_LABELS[id]}
          </button>
        );
      })}
    </div>
  );
}
