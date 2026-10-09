// The inbox (github.com/pulls): one collapsible card per saved view, Graphite-dense rows, j/k keyboard navigation and
// shareable view lists. Data comes through the DataSource; navigation goes through the parent page (src/app/bridge.ts).
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { postToParent } from '../app/bridge';
import type { DataSource } from '../app/data-source';
import { toGitHubUrl, type AppRoute } from '../app/routes';
import type { View, ViewResult } from '../lib/model';
import type { Settings } from '../lib/settings';
import { encodeViewsShareLink } from '../lib/views';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { RelativeTime } from '../ui/RelativeTime';
import { showToast, ToastHost } from '../ui/Toast';
import { importViews } from './import-views';
import { InboxSection } from './InboxSection';
import { moveSelection, type SelectedRow } from './selection';
import { ShortcutHelp } from './ShortcutHelp';
import './inbox.css';

export function InboxPage({ source, route }: { source: DataSource; route: Extract<AppRoute, { page: 'inbox' }> }) {
  const inbox = useInbox(source);
  const { settings } = inbox;
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  // The import offer is answered once per link; the route keeps the same array until the parent sends a new one.
  const [answeredImport, setAnsweredImport] = useState<View[] | null>(null);
  const pendingImport = route.importViews !== answeredImport ? route.importViews : null;

  const resultsByView = new Map(inbox.results?.map((result) => [result.view.id, result]));
  const firstView = settings?.views[0];
  const toReview = firstView && resultsByView.get(firstView.id)?.totalCount;

  useEffect(() => {
    if (toReview === undefined) return;
    const title = `Pull requests · ${toReview} to review`;
    document.title = title;
    postToParent({ type: 'gg:title', title });
  }, [toReview]);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Escape') {
      if (!helpOpen) return;
      setHelpOpen(false);
    } else if (event.key === '?') {
      setHelpOpen((open) => !open);
    } else if (helpOpen || !settings) {
      return;
    } else if (event.key === 'j' || event.key === 'k') {
      const sections = settings.views.map((view) => ({
        viewId: view.id,
        collapsed: view.collapsed === true,
        prIds: resultsByView.get(view.id)?.prs.map((pr) => pr.id) ?? [],
      }));
      setSelected(moveSelection(sections, selected, event.key === 'j' ? 1 : -1));
    } else if (event.key === 'Enter' || event.key === 'o' || event.key === 'O') {
      // Enter on a focused button or link belongs to that control.
      if (event.key === 'Enter' && target instanceof Element && target.closest('a, button')) return;
      const pr = selected && resultsByView.get(selected.viewId)?.prs.find((candidate) => candidate.id === selected.prId);
      if (!pr) return;
      openPullRequest(pr.url, event.shiftKey);
    } else if (event.key === 'r') {
      void inbox.refresh(true);
    } else if (event.key === 'c') {
      if (!selected) return;
      toggleCollapsed(selected.viewId);
    } else {
      return;
    }
    event.preventDefault();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);

  function toggleCollapsed(viewId: string) {
    if (!settings) return;
    void inbox.saveSettings({ views: settings.views.map((view) => (view.id === viewId ? { ...view, collapsed: !view.collapsed } : view)) });
  }

  function answerImport(answer: 'replace' | 'append' | 'dismiss') {
    if (settings && pendingImport && answer !== 'dismiss') {
      void inbox.saveSettings({ views: importViews(settings.views, pendingImport, answer) });
      showToast(answer === 'replace' ? 'Views replaced' : `Added ${pendingImport.length} ${pendingImport.length === 1 ? 'view' : 'views'}`);
    }
    setAnsweredImport(route.importViews);
    history.replaceState(null, '', '#/inbox');
    postToParent({ type: 'gg:replace-url', url: toGitHubUrl({ page: 'inbox', importViews: null }) });
  }

  async function copyShareLink() {
    if (!settings) return;
    try {
      await navigator.clipboard.writeText(encodeViewsShareLink(settings.views));
      showToast('Link copied');
    } catch {
      showToast('Could not copy the link', 'danger');
    }
  }

  function openOptions() {
    // Only the extension has an options page; in the standalone harness this is a no-op.
    if (browser?.runtime?.id) void browser.runtime.openOptionsPage();
  }

  if (!settings) return inbox.error ? <p className="gg-inbox__fatal">{inbox.error}</p> : null;

  return (
    <div className="gg-inbox">
      <header className="gg-inbox__bar">
        <div className="gg-inbox__bar-inner">
          <h1 className="gg-inbox__title">Pull requests</h1>
          <ScopeChip scope={settings.inboxScope} onSave={(inboxScope) => void inbox.saveSettings({ inboxScope })} />
          <div className="gg-inbox__actions">
            <Button
              variant="ghost"
              size="sm"
              icon="sync"
              className={inbox.refreshing ? 'is-spinning' : undefined}
              title="Refresh (r)"
              onClick={() => void inbox.refresh(true)}
            >
              {inbox.fetchedAt === null ? 'Loading…' : <>Updated <RelativeTime date={new Date(inbox.fetchedAt).toISOString()} ago /></>}
            </Button>
            <Button size="sm" icon="link" title="Copy a link that shares these views" onClick={() => void copyShareLink()}>
              Share
            </Button>
            <Button size="sm" icon="gear" title="Views and other settings" onClick={openOptions}>
              Configure
            </Button>
            {window.parent !== window && (
              <Button
                variant="ghost"
                size="sm"
                icon="mark-github"
                title="Show GitHub's own page from now on; the Graphite view button at its bottom right switches back"
                onClick={() => void inbox.saveSettings({ inboxEnabled: false })}
              >
                Use GitHub's view
              </Button>
            )}
            <Button variant="ghost" size="sm" icon="question" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setHelpOpen((open) => !open)} />
          </div>
        </div>
      </header>

      <main className="gg-inbox__body">
        {pendingImport && (
          <div className="gg-inbox__notice gg-inbox__notice--accent" role="region" aria-label="Import shared views">
            <Icon name="link" />
            <span className="gg-inbox__notice-text">
              <strong>
                Import {pendingImport.length} {pendingImport.length === 1 ? 'view' : 'views'} from this link
              </strong>
              <span className="gg-inbox__notice-detail">{pendingImport.map((view) => view.name).join(' · ')}</span>
            </span>
            <span className="gg-inbox__notice-actions">
              <Button size="sm" variant="primary" onClick={() => answerImport('replace')}>
                Replace
              </Button>
              <Button size="sm" onClick={() => answerImport('append')}>
                Append
              </Button>
              <Button size="sm" variant="ghost" onClick={() => answerImport('dismiss')}>
                Dismiss
              </Button>
            </span>
          </div>
        )}

        {inbox.error && (
          <div className="gg-inbox__notice gg-inbox__notice--danger" role="alert">
            <Icon name="alert" />
            <span className="gg-inbox__notice-text">{inbox.error}</span>
          </div>
        )}

        {settings.views.length === 0 && <p className="gg-inbox__muted">No views yet. Add one under Configure.</p>}

        {settings.views.map((view) => (
          <InboxSection
            key={view.id}
            view={view}
            result={resultsByView.get(view.id)}
            loading={inbox.error === null}
            selectedPrId={selected?.viewId === view.id ? selected.prId : null}
            overdueAfterHours={view.id === 'needs-review' ? 48 : undefined}
            onToggleCollapsed={() => toggleCollapsed(view.id)}
            onOpen={(pr, newTab) => {
              setSelected({ viewId: view.id, prId: pr.id });
              openPullRequest(pr.url, newTab);
            }}
          />
        ))}
      </main>

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      <ToastHost />
    </div>
  );
}

/**
 * Settings plus every view's results, kept fresh: refetched when what GitHub is asked changes (not on rename or
 * collapse), every 2 minutes while the tab is visible, and on returning to the tab when older than a minute.
 */
function useInbox(source: DataSource) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [results, setResults] = useState<ViewResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latestRequest = useRef(0);

  useEffect(() => {
    let active = true;
    source.getSettings().then(
      (loaded) => active && setSettings(loaded),
      (cause: unknown) => active && setError(cause instanceof Error ? cause.message : String(cause)),
    );
    const unwatch = source.watchSettings(setSettings);
    return () => {
      active = false;
      unwatch();
    };
  }, [source]);

  async function refresh(force: boolean) {
    if (!settings) return;
    const request = ++latestRequest.current;
    setRefreshing(true);
    try {
      const fresh = await source.fetchInbox(settings.views, force);
      if (request !== latestRequest.current) return;
      setResults(fresh);
      setError(null);
      setFetchedAt(Date.now());
    } catch (cause) {
      if (request === latestRequest.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === latestRequest.current) setRefreshing(false);
    }
  }

  async function saveSettings(patch: Partial<Settings>) {
    try {
      setSettings(await source.setSettings(patch));
    } catch (cause) {
      showToast(`Could not save: ${cause instanceof Error ? cause.message : String(cause)}`, 'danger');
    }
  }

  const queriesKey = settings && JSON.stringify([settings.inboxScope, settings.views.map(({ id, query, limit }) => [id, query, limit])]);
  const keepFresh = useEffectEvent((trigger: 'queries' | 'timer' | 'visible') => {
    if (trigger !== 'queries' && document.visibilityState !== 'visible') return;
    if (trigger === 'visible' && fetchedAt !== null && Date.now() - fetchedAt < 60_000) return;
    void refresh(false);
  });

  useEffect(() => {
    if (queriesKey) keepFresh('queries');
  }, [queriesKey]);

  useEffect(() => {
    const timer = setInterval(() => keepFresh('timer'), 120_000);
    const onVisibilityChange = () => keepFresh('visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return { settings, results, error, fetchedAt, refreshing, refresh, saveSettings };
}

/** Opens a PR the way a link would: the github.com page navigates (or opens a tab); the standalone harness opens a tab. */
function openPullRequest(url: string, newTab: boolean) {
  if (window.parent === window) window.open(url, '_blank');
  else postToParent({ type: 'gg:navigate', url, newTab });
}

/** The global scope (`org:acme`) prepended to every view; click to edit inline, Enter saves, Esc or blur cancels. */
function ScopeChip({ scope, onSave }: { scope: string; onSave: (scope: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <button type="button" className="gg-inbox__scope" title="Prepended to every view's query. Click to change." onClick={() => setDraft(scope)}>
        <Icon name="repo" size={14} />
        {scope || 'All repositories'}
      </button>
    );
  }
  return (
    <input
      className="gg-inbox__scope-input"
      autoFocus
      value={draft}
      placeholder="org:acme or repo:acme/widgets — Enter to save"
      aria-label="Inbox scope"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => setDraft(null)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setDraft(null);
        if (event.key !== 'Enter') return;
        if (draft.trim() !== scope) onSave(draft.trim());
        setDraft(null);
      }}
    />
  );
}
