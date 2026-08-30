import { useState } from 'react';
import type { Snippet } from '../lib/snippet';

const SNIPPET_HINT = 'Updates with the form — values come from @sodax/types';

/** Renders whichever flow's snippets it is handed — the view decides what those are. */
export function CodePanel({ snippets, initialId }: { snippets: Snippet[]; initialId: string }) {
  const [activeId, setActiveId] = useState(initialId);
  const [copied, setCopied] = useState(false);

  const active = snippets.find(snippet => snippet.id === activeId) ?? snippets[0];

  const copy = async () => {
    await navigator.clipboard.writeText(active.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="card code-card">
      <header className="code-header">
        <div className="tabs">
          {snippets.map(snippet => (
            <button
              type="button"
              key={snippet.id}
              className={snippet.id === activeId ? 'tab tab-active' : 'tab'}
              onClick={() => setActiveId(snippet.id)}
            >
              {snippet.label}
            </button>
          ))}
        </div>
        <div className="code-actions">
          <span className="hint">
            <button type="button" className="hint-trigger" aria-label={SNIPPET_HINT}>
              {/* lucide's `info`, inlined — the playground carries no icon dependency. */}
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
            </button>
            <span className="hint-bubble" role="tooltip">
              {SNIPPET_HINT}
            </span>
          </span>
          <button type="button" className="btn" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <a className="btn btn-docs" href="https://docs.sodax.com/" target="_blank" rel="noreferrer">
            Read the docs ↗
          </a>
        </div>
      </header>
      <pre className="code">
        <code>{active.code}</code>
      </pre>
      <p className="code-note muted small">
        Building with an AI agent? <code>npx skills@latest add icon-project/sodax-sdks/packages/skills</code>{' '}
        <a className="link" href="https://docs.sodax.com/developers/ai-integration" target="_blank" rel="noreferrer">
          AI integration guide ↗
        </a>
      </p>
    </section>
  );
}
