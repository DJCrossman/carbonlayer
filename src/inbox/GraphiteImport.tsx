// Importing Graphite's PR-inbox sections (src/lib/graphite.ts): paste section links, preview the views they become and
// what GitHub's search only approximates, name the views, then add them or replace the current ones. Shown in the
// inbox's "Import from Graphite…" dialog and on the options page, which each save the result their own way.
import { useState } from 'react';
import { importGraphiteSections } from '../lib/graphite';
import type { View } from '../lib/model';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import './graphite-import.css';

export function GraphiteImport({ autoFocus, onImport }: { autoFocus?: boolean; onImport: (views: View[], mode: 'replace' | 'append') => void }) {
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<{ views: View[]; notes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unnamed = preview?.views.some((view) => !view.name.trim()) ?? false;

  function showPreview() {
    try {
      setPreview(importGraphiteSections(input));
      setError(null);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function finish(mode: 'replace' | 'append') {
    if (!preview || unnamed) return;
    onImport(
      preview.views.map((view) => ({ ...view, name: view.name.trim() })),
      mode,
    );
    setInput('');
    setPreview(null);
  }

  return (
    <div className="gg-graphite-import">
      <textarea
        className="gg-graphite-import__input"
        autoFocus={autoFocus}
        rows={3}
        spellCheck={false}
        aria-label="Graphite section links"
        placeholder="Paste Graphite section links, one per line: https://app.graphite.com/?new-section=… or ?shared-sections=…"
        value={input}
        onChange={(event) => {
          setInput(event.target.value);
          setPreview(null);
          setError(null);
        }}
      />
      <div className="gg-graphite-import__row">
        <Button size="sm" disabled={!input.trim()} onClick={showPreview}>
          Preview
        </Button>
        {error && (
          <span className="gg-graphite-import__error" role="alert">
            {error}
          </span>
        )}
      </div>

      {preview && (
        <>
          <ul className="gg-graphite-import__views" aria-label="Views to import">
            {preview.views.map((view) => (
              <li key={view.id} className="gg-graphite-import__view">
                <input
                  type="text"
                  aria-label="Imported view name"
                  placeholder="Name this view"
                  value={view.name}
                  onChange={(event) =>
                    setPreview({ ...preview, views: preview.views.map((other) => (other.id === view.id ? { ...other, name: event.target.value } : other)) })
                  }
                />
                <code>{view.query}</code>
              </li>
            ))}
          </ul>
          {preview.notes.length > 0 && (
            <ul className="gg-graphite-import__notes" aria-label="What GitHub's search approximates">
              {preview.notes.map((note, index) => (
                <li key={index}>
                  <Icon name="alert" size={12} />
                  {note}
                </li>
              ))}
            </ul>
          )}
          <div className="gg-graphite-import__row">
            <Button size="sm" variant="primary" disabled={unnamed} onClick={() => finish('append')}>
              Add views
            </Button>
            <Button size="sm" disabled={unnamed} onClick={() => finish('replace')}>
              Replace views
            </Button>
            {unnamed && <span className="gg-graphite-import__error">Give every view a name.</span>}
          </div>
        </>
      )}
    </div>
  );
}
