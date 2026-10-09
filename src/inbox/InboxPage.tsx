// The inbox (the github.com homepage): Graphite's sections sidebar beside one collapsible card per saved view,
// Graphite-dense rows, j/k keyboard navigation, shareable view lists, and Graphite's section editor in a drawer. Data comes through the DataSource; navigation goes through the parent page
// (src/app/bridge.ts).
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { postToParent } from '../app/bridge';
import type { DataSource } from '../app/data-source';
import { toGitHubUrl, type AppRoute } from '../app/routes';
import type { View, ViewResult } from '../lib/model';
import type { Settings } from '../lib/settings';
import { encodeViewsShareLink, sectionCount } from '../lib/views';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { RelativeTime } from '../ui/RelativeTime';
import { showToast, ToastHost } from '../ui/Toast';
import { GraphiteImport } from './GraphiteImport';
import { importViews } from './import-views';
import { InboxSection, type SectionSort } from './InboxSection';
import { RepoPicker } from './RepoPicker';
import { SectionEditor } from './SectionEditor';
import { SectionsSidebar } from './SectionsSidebar';
import { moveSelection, type SelectedRow } from './selection';
import { ShortcutHelp } from './ShortcutHelp';
import './inbox.css';

export function InboxPage({ source, route }: { source: DataSource; route: Extract<AppRoute, { page: 'inbox' }> }) {
  const inbox = useInbox(source);
  const { settings } = inbox;
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [graphiteOpen, setGraphiteOpen] = useState(false);
  // The view in the section editor, 'new' for one being added.
  const [editing, setEditing] = useState<View | 'new' | null>(null);
  // The sidebar over the inbox, on a window too narrow to show it beside the sections.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentViewId, showViewId] = useSectionInView(settings?.views);
  // The import offer is answered once per link; the route keeps the same array until the parent sends a new one.
  const [answeredImport, setAnsweredImport] = useState<View[] | null>(null);
  const pendingImport = route.importViews !== answeredImport ? route.importViews : null;

  // How each section orders its rows, as its column headers were last clicked (this visit only).
  const [sorts, setSorts] = useState<Record<string, SectionSort>>({});
  // Each section's rows in the order it shows them, which j / k follow too.
  const resultsByView = new Map(
    inbox.results?.map((result) => {
      const { by, descending } = sorts[result.view.id] ?? LATEST_UPDATED_FIRST;
      const prs = result.prs.toSorted((a, b) => {
        const ascending =
          by === 'title' ? a.title.localeCompare(b.title) : by === 'changes' ? a.additions + a.deletions - (b.additions + b.deletions) : Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
        return descending ? -ascending : ascending;
      });
      return [result.view.id, { ...result, prs }];
    }),
  );
  const firstResult = settings?.views[0] && resultsByView.get(settings.views[0].id);
  const toReview = firstResult && sectionCount(firstResult);

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
    } else if (graphiteOpen || editing) {
      // The import dialog's and the section editor's own keys (they close themselves on Esc).
      return;
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

  function sortSection(viewId: string, by: SectionSort['by']) {
    // The same column again flips the order; another starts with the largest and latest first, titles from A.
    setSorts((current) => {
      const now = current[viewId] ?? LATEST_UPDATED_FIRST;
      return { ...current, [viewId]: now.by === by ? { by, descending: !now.descending } : { by, descending: by !== 'title' } };
    });
  }

  function goToSection(view: View) {
    if (view.collapsed) toggleCollapsed(view.id);
    document.querySelector(`[data-view-id="${CSS.escape(view.id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    showViewId(view.id);
    setSidebarOpen(false);
  }

  function moveSection(index: number, offset: -1 | 1) {
    if (!settings) return;
    const views = [...settings.views];
    const [view] = views.splice(index, 1);
    if (view) views.splice(index + offset, 0, view);
    void inbox.saveSettings({ views });
  }

  function toggleSidebar() {
    // A narrow window shows the sidebar over the inbox for a moment; a wide one remembers it shown or hidden.
    if (window.matchMedia('(max-width: 899px)').matches) setSidebarOpen(!sidebarOpen);
    else void inbox.saveSettings({ sidebarCollapsed: !settings?.sidebarCollapsed });
  }

  function saveSection(saved: View) {
    if (!settings) return;
    const exists = settings.views.some((view) => view.id === saved.id);
    void inbox.saveSettings({ views: exists ? settings.views.map((view) => (view.id === saved.id ? saved : view)) : [...settings.views, saved] });
    showToast(exists ? 'Section saved' : 'Section added');
    setEditing(null);
  }

  function deleteSection(deleted: View) {
    if (!settings || !window.confirm(`Delete the section “${deleted.name}”?`)) return;
    void inbox.saveSettings({ views: settings.views.filter((view) => view.id !== deleted.id) });
    setEditing(null);
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
          <Button
            variant="ghost"
            size="sm"
            icon="sidebar"
            className={settings.sidebarCollapsed ? 'gg-inbox__sidebar-toggle is-collapsed' : 'gg-inbox__sidebar-toggle'}
            aria-label="Sections"
            aria-expanded={sidebarOpen}
            title="Show sections"
            onClick={toggleSidebar}
          />
          <h1 className="gg-inbox__title">
            <Icon name="logo" className="gg-inbox__logo" />
            Pull requests
          </h1>
          <RepoPicker
            chip
            selected={settings.inboxRepos}
            emptyLabel={settings.inboxScope || 'All repositories'}
            title={settings.inboxScope ? `Every section searches ${settings.inboxScope}, unless it names repositories of its own` : 'Every section searches all repositories'}
            searchRepos={source.searchRepos}
            onChange={(inboxRepos) => void inbox.saveSettings({ inboxRepos })}
          />
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
            <Button size="sm" icon="stack" title="Copy your sections from Graphite, or paste section links" onClick={() => setGraphiteOpen(true)}>
              Import from Graphite…
            </Button>
            <Button size="sm" icon="gear" title="Views and other settings" onClick={openOptions}>
              Configure
            </Button>
            <Button variant="ghost" size="sm" icon="question" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setHelpOpen((open) => !open)} />
          </div>
        </div>
      </header>

      <div className={settings.sidebarCollapsed ? 'gg-inbox__layout is-sidebar-collapsed' : 'gg-inbox__layout'}>
        {(!settings.sidebarCollapsed || sidebarOpen) && (
          <SectionsSidebar
            views={settings.views}
            resultsByView={resultsByView}
            currentViewId={currentViewId}
            open={sidebarOpen}
            onSelect={goToSection}
            onMove={moveSection}
            onEdit={(view) => {
              setEditing(view);
              setSidebarOpen(false);
            }}
            onAdd={() => {
              setEditing('new');
              setSidebarOpen(false);
            }}
            onHide={toggleSidebar}
          />
        )}
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

          {settings.views.length === 0 && <p className="gg-inbox__muted">No sections yet: Add section in the sidebar adds one.</p>}

          {settings.views.map((view) => (
            <div key={view.id} className="gg-inbox__section" data-view-id={view.id}>
              <InboxSection
                view={view}
                result={resultsByView.get(view.id)}
                loading={inbox.error === null}
                sort={sorts[view.id] ?? LATEST_UPDATED_FIRST}
                selectedPrId={selected?.viewId === view.id ? selected.prId : null}
                overdueAfterHours={view.id === 'graphite-needs-your-review' ? 48 : undefined}
                onSort={(by) => sortSection(view.id, by)}
                onToggleCollapsed={() => toggleCollapsed(view.id)}
                onEdit={() => setEditing(view)}
                onOpen={(pr, newTab) => {
                  setSelected({ viewId: view.id, prId: pr.id });
                  openPullRequest(pr.url, newTab);
                }}
              />
            </div>
          ))}
        </main>
      </div>

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      {editing && (
        <SectionEditor
          searchRepos={source.searchRepos}
          key={editing === 'new' ? 'new' : editing.id}
          view={editing === 'new' ? null : editing}
          onSave={saveSection}
          onDelete={editing === 'new' ? undefined : () => deleteSection(editing)}
          onClose={() => setEditing(null)}
        />
      )}
      {graphiteOpen && (
        <div
          className="gg-help"
          role="dialog"
          aria-modal="true"
          aria-label="Import from Graphite"
          onKeyDown={(event) => event.key === 'Escape' && setGraphiteOpen(false)}
        >
          <div className="gg-help__panel gg-inbox__graphite">
            <header className="gg-help__header">
              Import from Graphite
              <Button variant="ghost" size="sm" icon="x" aria-label="Close" onClick={() => setGraphiteOpen(false)} />
            </header>
            <div className="gg-inbox__graphite-body">
              <GraphiteImport
                autoFocus
                currentInboxScope={settings.inboxScope}
                onImport={(views, mode, inboxRepos) => {
                  void inbox.saveSettings({
                    views: importViews(settings.views, views, mode),
                    ...(inboxRepos !== undefined && { inboxRepos }),
                  });
                  showToast(mode === 'replace' ? 'Views replaced' : `Added ${views.length} ${views.length === 1 ? 'view' : 'views'}`);
                  setGraphiteOpen(false);
                }}
              />
            </div>
          </div>
        </div>
      )}
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

/**
 * The section the reader is at: the first whose card reaches below the top bar, as the page scrolls, or the one just
 * gone to, until the reader scrolls on their own.
 */
function useSectionInView(views: View[] | undefined): [string | null, (viewId: string) => void] {
  const [current, setCurrent] = useState<string | null>(null);
  const goneTo = useRef<{ viewId: string; at: number } | null>(null);
  const viewCount = views?.length ?? 0;
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      // A smooth scroll to the section just gone to is not the reader scrolling.
      if (goneTo.current && Date.now() - goneTo.current.at < 1000) return;
      goneTo.current = null;
      const sections = [...document.querySelectorAll<HTMLElement>('[data-view-id]')];
      const reached = sections.find((section) => section.getBoundingClientRect().bottom > 60) ?? sections.at(-1);
      setCurrent(reached?.dataset.viewId ?? null);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [viewCount]);
  return [
    current,
    (viewId) => {
      goneTo.current = { viewId, at: Date.now() };
      setCurrent(viewId);
    },
  ];
}

/** Graphite's default order for a section's rows. */
const LATEST_UPDATED_FIRST: SectionSort = { by: 'updated', descending: true };

/** Opens a PR the way a link would: the github.com page navigates (or opens a tab); the standalone harness opens a tab. */
function openPullRequest(url: string, newTab: boolean) {
  if (window.parent === window) window.open(url, '_blank');
  else postToParent({ type: 'gg:navigate', url, newTab });
}
