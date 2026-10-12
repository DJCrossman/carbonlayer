// Importing Graphite's PR-inbox sections (src/lib/graphite.ts): copy every section from the user's signed-in Graphite
// inbox in one click, or paste section links; preview the view each section becomes, with what GitHub's search only
// approximates under it, name the views, then add them or replace the current ones. Shown in the inbox's "Import from
// Graphite…" dialog and on the options page, which each save the result their own way.
//
// "Copy my sections from Graphite" asks the background (entrypoints/background.ts) to open Graphite in a tab, where
// entrypoints/graphite.content.ts copies the sections; the background stores them under `graphiteImport` in
// storage.local, which this reads when it opens and watches while it is open. A copy stays there until it is added,
// replaces the views or is dismissed.
import { Fragment, useEffect, useId, useState } from 'react';
import { browser } from 'wxt/browser';
import { importGraphiteSections, type GraphiteInboxSnapshot } from '../lib/graphite';
import type { Organization, RepoRef, View } from '../lib/model';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { RelativeTime } from '../ui/RelativeTime';
import { placeGraphiteImport } from './import-views';
import './graphite-import.css';

/**
 * `inbox`, when given (the organization the inbox shows, its chosen repositories, and the viewer's organizations), offers
 * to search the Graphite inbox's repositories (`placeGraphiteImport`): `onImport` then gets the organization the views go
 * to, and its repositories to save, if they change.
 */
export function GraphiteImport({
  autoFocus,
  inbox,
  onImport,
}: {
  autoFocus?: boolean;
  inbox?: { org: Organization; repos: RepoRef[]; organizations: Organization[] };
  onImport: (views: View[], mode: 'replace' | 'append', destination?: { org: Organization; inboxRepos?: RepoRef[] }) => void;
}) {
  const inputId = useId();
  const [input, setInput] = useState('');
  // `copiedAt` when the views come from sections copied out of Graphite's inbox.
  const [preview, setPreview] = useState<(ReturnType<typeof importGraphiteSections> & { copiedAt?: string }) | null>(null);
  const [setScope, setSetScope] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [waitingForGraphite, setWaitingForGraphite] = useState(false);
  const [copyProblem, setCopyProblem] = useState<string | null>(null);
  // Who is signed in to Graphite, from its inbox page: pasted links search that login as @me too.
  const [viewerLogin, setViewerLogin] = useState<string | undefined>();
  const unnamed = preview?.views.some(({ view }) => !view.name.trim()) ?? false;
  const offeredRepos = inbox ? preview?.inboxRepos : null;
  const placed = inbox && preview && offeredRepos ? placeGraphiteImport(preview.views.map(({ view }) => view), offeredRepos, inbox.org, inbox.organizations) : null;
  // Adding views to the inbox's own organization keeps the repositories already chosen for it.
  const keepsRepos = placed?.org.login === inbox?.org.login && (inbox?.repos.length ?? 0) > 0;

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
        setSetScope(true);
        setViewerLogin(copy.viewerLogin);
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
      setPreview(importGraphiteSections(input, { viewerLogin }));
      setSetScope(true);
      setError(null);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function finish(mode: 'replace' | 'append' | 'dismiss') {
    if (!preview || (mode !== 'dismiss' && unnamed)) return;
    if (mode !== 'dismiss') {
      const named = new Map(preview.views.map(({ view }) => [view.id, view.name.trim()]));
      const views = placed && setScope ? placed.views : preview.views.map(({ view }) => view);
      onImport(
        views.map((view) => ({ ...view, name: named.get(view.id) ?? view.name })),
        mode,
        placed && setScope ? { org: placed.org, inboxRepos: placed.inboxRepos && !(mode === 'append' && keepsRepos) ? placed.inboxRepos : undefined } : undefined,
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
          <p className="gg-graphite-import__status">
            {preview.copiedAt && (
              <>
                Copied from your Graphite inbox <RelativeTime date={preview.copiedAt} ago />:{' '}
              </>
            )}
            {preview.sectionCount} {preview.sectionCount === 1 ? 'section' : 'sections'} → {preview.views.length} {preview.views.length === 1 ? 'view' : 'views'}
          </p>
          {preview.notes.length > 0 && (
            <ul className="gg-graphite-import__notes" aria-label="Sections left out">
              {preview.notes.map((note, index) => (
                <li key={index}>
                  <Icon name="alert" size={12} />
                  {note}
                </li>
              ))}
            </ul>
          )}
          {offeredRepos && placed && inbox && (
            <label className="gg-graphite-import__scope">
              <input type="checkbox" checked={setScope} onChange={(event) => setSetScope(event.target.checked)} />
              <span>
                {placed.inboxRepos
                  ? `Search these repositories in ${placed.org.login}'s inbox${placed.org.login === inbox.org.login ? '' : ', and add the sections there'}: `
                  : 'Search these repositories in each section that searched them in Graphite: '}
                <code>{offeredRepos.map((repo) => `${repo.owner}/${repo.name}`).join(', ')}</code>
                {placed.inboxRepos && keepsRepos && <span className="gg-graphite-import__status"> (Add views keeps the repositories chosen now)</span>}
              </span>
            </label>
          )}
          <ul className="gg-graphite-import__views" aria-label="Views to import">
            {preview.views.map(({ view, notes }) => (
              <li key={view.id} className="gg-graphite-import__view">
                <input
                  type="text"
                  aria-label="Imported view name"
                  placeholder="Name this view"
                  value={view.name}
                  onChange={(event) =>
                    setPreview({
                      ...preview,
                      views: preview.views.map((other) => (other.view.id === view.id ? { ...other, view: { ...view, name: event.target.value } } : other)),
                    })
                  }
                />
                <div className="gg-graphite-import__view-detail">
                  {/* A line breaks between terms, never after a term's leading "-". */}
                  <code>
                    {view.query.split(' ').map((term, index) => (
                      <Fragment key={index}>
                        {index > 0 && ' '}
                        <span>{term}</span>
                      </Fragment>
                    ))}
                  </code>
                  {notes.length > 0 && (
                    <ul className="gg-graphite-import__notes" aria-label="What GitHub's search approximates">
                      {notes.map((note, index) => (
                        <li key={index}>
                          <Icon name="alert" size={12} />
                          {note}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
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
