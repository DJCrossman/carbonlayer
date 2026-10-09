// The inbox views: one row per view (name, its search query as text, limit, "Edit…" for the section editor),
// reordering, Graphite's defaults, share links in both directions and Graphite's own section links. Only a list where
// every view is valid is passed on to be saved.
import { useState } from 'react';
import type { View } from '../../src/lib/model';
import { GraphiteImport } from '../../src/inbox/GraphiteImport';
import { importViews } from '../../src/inbox/import-views';
import { SectionEditor } from '../../src/inbox/SectionEditor';
import { DEFAULT_VIEWS, decodeViewsShareHash, encodeViewsShareLink } from '../../src/lib/views';

export function ViewsEditor({ views, onChange }: { views: View[]; onChange: (views: View[], typing: boolean) => void }) {
  const [draft, setDraft] = useState(views);
  const [importLink, setImportLink] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  // The view in the section editor, 'new' for one being added.
  const [editing, setEditing] = useState<View | 'new' | null>(null);
  const problems = draft.map((view, index) => viewProblem(view, draft, index));

  function change(next: View[], typing = false) {
    setDraft(next);
    if (next.every((view, index) => viewProblem(view, next, index) === null)) onChange(next, typing);
  }

  function edit(index: number, patch: Partial<View>) {
    change(
      draft.map((view, i) => (i === index ? { ...view, ...patch } : view)),
      true,
    );
  }

  function move(index: number, offset: -1 | 1) {
    const next = [...draft];
    const [view] = next.splice(index, 1);
    if (view) next.splice(index + offset, 0, view);
    change(next);
  }

  function importFromLink(mode: 'replace' | 'append') {
    let imported: View[] | null = null;
    try {
      imported = decodeViewsShareHash(new URL(importLink.trim(), 'https://github.com/').hash);
    } catch {
      // Not a URL at all.
    }
    if (!imported) {
      setNotice('That link does not carry any views.');
      return;
    }
    change(importViews(draft, imported, mode));
    setImportLink('');
    setNotice(`Imported ${imported.length} ${imported.length === 1 ? 'view' : 'views'}.`);
  }

  async function copyShareLink() {
    await navigator.clipboard.writeText(encodeViewsShareLink(draft));
    setNotice('Share link copied.');
  }

  return (
    <div className="views">
      <div className="views-head">
        <span>Name</span>
        <span>Search query</span>
        <span>Limit</span>
      </div>
      {draft.map((view, index) => (
        <div key={view.id} className="view-row">
          <input type="text" aria-label="View name" value={view.name} placeholder="Name" onChange={(event) => edit(index, { name: event.target.value })} />
          <code className="view-query" title={view.query}>
            {view.query}
          </code>
          <input
            type="number"
            aria-label="Limit"
            min={1}
            max={100}
            placeholder="50"
            value={view.limit ?? ''}
            onChange={(event) => edit(index, { limit: event.target.value === '' ? undefined : Number(event.target.value) })}
          />
          <span className="row-actions">
            <button type="button" title={view.filter ? 'Edit the filters' : 'Edit the search query'} onClick={() => setEditing(view)}>
              Edit…
            </button>
            <button type="button" className="icon" title="Move up" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
              ↑
            </button>
            <button
              type="button"
              className="icon"
              title="Move down"
              aria-label="Move down"
              disabled={index === draft.length - 1}
              onClick={() => move(index, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="icon"
              title="Delete view"
              aria-label="Delete view"
              onClick={() => change(draft.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </span>
          {problems[index] && <span className="problem">{problems[index]}</span>}
        </div>
      ))}
      <p className="hint">Edit… changes a view's filters the way Graphite's section editor does, or its GitHub search query by hand. Limit defaults to 50, at most 100.</p>

      <div className="row">
        <button type="button" onClick={() => setEditing('new')}>
          Add view…
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Replace your views with Graphite's defaults?")) change(DEFAULT_VIEWS);
          }}
        >
          Reset to Graphite defaults
        </button>
        <button type="button" disabled={problems.some(Boolean) || draft.length === 0} onClick={() => void copyShareLink()}>
          Copy share link
        </button>
      </div>

      <div className="row">
        <input
          type="text"
          className="grow"
          aria-label="Share link to import"
          value={importLink}
          placeholder="Paste a share link (https://github.com/#views=…)"
          onChange={(event) => setImportLink(event.target.value)}
        />
        <button type="button" disabled={!importLink.trim()} onClick={() => importFromLink('replace')}>
          Replace
        </button>
        <button type="button" disabled={!importLink.trim()} onClick={() => importFromLink('append')}>
          Append
        </button>
      </div>
      {notice && <p className="status muted">{notice}</p>}

      <h3>Import from Graphite</h3>
      <p className="hint">
        Graphite's “Share section” or “Share all sections” links, or the JSON they carry, become views; the preview says what GitHub's search can only
        approximate.
      </p>
      <GraphiteImport
        onImport={(imported, mode) => {
          change(importViews(draft, imported, mode));
          setNotice(`Imported ${imported.length} ${imported.length === 1 ? 'view' : 'views'} from Graphite.`);
        }}
      />

      {editing && (
        <SectionEditor
          key={editing === 'new' ? 'new' : editing.id}
          view={editing === 'new' ? null : editing}
          onSave={(saved) => {
            change(draft.some((view) => view.id === saved.id) ? draft.map((view) => (view.id === saved.id ? saved : view)) : [...draft, saved]);
            setEditing(null);
          }}
          onDelete={
            editing === 'new'
              ? undefined
              : () => {
                  change(draft.filter((view) => view.id !== editing.id));
                  setEditing(null);
                }
          }
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** What stops this view from being saved, or null when it is fine. */
function viewProblem(view: View, views: View[], index: number): string | null {
  if (!view.name.trim()) return 'Give the view a name.';
  if (!view.query.trim()) return 'Give the view a search query.';
  if (view.limit !== undefined && (!Number.isInteger(view.limit) || view.limit < 1 || view.limit > 100)) return 'Limit must be a whole number from 1 to 100.';
  if (views.findIndex((other) => other.id === view.id) !== index) return 'Another view has the same id.';
  return null;
}
