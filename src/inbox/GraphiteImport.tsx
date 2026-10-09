// Importing Graphite's PR-inbox sections (src/lib/graphite.ts): copy every section from the user's signed-in Graphite
// inbox in one click, or paste section links; preview the views they become and what GitHub's search only
// approximates, name the views, then add them or replace the current ones. Shown in the inbox's "Import from
// Graphite…" dialog and on the options page, which each save the result their own way.
//
// "Copy my sections from Graphite" asks the background (entrypoints/background.ts) to open Graphite in a tab, where
// entrypoints/graphite.content.ts copies the sections; the background stores them under `graphiteImport` in
// storage.local, which this reads when it opens and watches while it is open. A copy stays there until it is added,
// replaces the views or is dismissed.
import { useEffect, useId, useState } from 'react';
import { browser } from 'wxt/browser';
import { importGraphiteSections, type GraphiteInboxSnapshot } from '../lib/graphite';
import type { View } from '../lib/model';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { RelativeTime } from '../ui/RelativeTime';
import './graphite-import.css';

export function GraphiteImport({ autoFocus, onImport }: { autoFocus?: boolean; onImport: (views: View[], mode: 'replace' | 'append') => void }) {
  const inputId = useId();
  const [input, setInput] = useState('');
  // `copiedAt` when the views come from sections copied out of Graphite's inbox.
  const [preview, setPreview] = useState<{ views: View[]; notes: string[]; copiedAt?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitingForGraphite, setWaitingForGraphite] = useState(false);
  const [copyProblem, setCopyProblem] = useState<string | null>(null);
  const unnamed = preview?.views.some((view) => !view.name.trim()) ?? false;

  useEffect(() => {
    // Standalone (the harness) no extension copies anything.
    if (!browser?.runtime?.id) return;
    const show = (copy: GraphiteCopy | undefined) => {
      if (!copy) return;
      setWaitingForGraphite(false);
      if ('error' in copy) {
        setCopyProblem(copy.error);
        return;
      }
      try {
        setPreview({ ...importGraphiteSections(copy), copiedAt: copy.at });
        setCopyProblem(null);
        setError(null);
      } catch (cause) {
        setCopyProblem(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void browser.storage.local.get('graphiteImport').then(({ graphiteImport }) => {
      const copy = graphiteImport as GraphiteCopy | undefined;
      // Why an earlier copy failed is not news now.
      if (copy && !('error' in copy)) show(copy);
    });
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && changes.graphiteImport) show(changes.graphiteImport.newValue as GraphiteCopy | undefined);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, []);

  function copyFromGraphite() {
    if (!browser?.runtime?.id) {
      // Standalone (the harness): Graphite opens, but nothing copies from it.
      window.open('https://app.graphite.com/', '_blank', 'noopener');
      return;
    }
    void browser.runtime.sendMessage({ kind: 'carbonlayer-open-graphite-import' });
    setWaitingForGraphite(true);
    setCopyProblem(null);
  }

  function showPreview() {
    try {
      setPreview(importGraphiteSections(input));
      setError(null);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function finish(mode: 'replace' | 'append' | 'dismiss') {
    if (!preview || (mode !== 'dismiss' && unnamed)) return;
    if (mode !== 'dismiss') {
      onImport(
        preview.views.map((view) => ({ ...view, name: view.name.trim() })),
        mode,
      );
      setInput('');
    }
    // A copy from Graphite is answered once.
    if (preview.copiedAt) void browser.storage.local.remove('graphiteImport');
    setPreview(null);
  }

  return (
    <div className="gg-graphite-import">
      <div className="gg-graphite-import__row">
        <Button size="sm" variant={preview ? 'default' : 'primary'} icon="stack" autoFocus={autoFocus} onClick={copyFromGraphite}>
          Copy my sections from Graphite
        </Button>
        {waitingForGraphite && <span className="gg-graphite-import__status">Waiting for Graphite… keep the tab that opens signed in.</span>}
        {copyProblem && (
          <span className="gg-graphite-import__error" role="alert">
            {copyProblem}
          </span>
        )}
      </div>

      <label className="gg-graphite-import__label" htmlFor={inputId}>
        Or paste a share link / JSON
      </label>
      <textarea
        id={inputId}
        className="gg-graphite-import__input"
        rows={2}
        spellCheck={false}
        placeholder="Graphite section links, one per line: https://app.graphite.com/?new-section=… or ?shared-sections=…"
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
          {preview.copiedAt && (
            <p className="gg-graphite-import__status">
              Copied from your Graphite inbox <RelativeTime date={preview.copiedAt} ago />.
            </p>
          )}
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
            <Button size="sm" variant="ghost" onClick={() => finish('dismiss')}>
              Dismiss
            </Button>
            {unnamed && <span className="gg-graphite-import__error">Give every view a name.</span>}
          </div>
        </>
      )}
    </div>
  );
}

/** What the background stores under `graphiteImport` in storage.local: the sections copied, or why copying failed. */
type GraphiteCopy = ({ at: string } & GraphiteInboxSnapshot) | { at: string; error: string };
