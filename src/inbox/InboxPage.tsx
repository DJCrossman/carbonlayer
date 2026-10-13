// The inbox (the github.com homepage): one organization's pull requests at a time, chosen in the top bar (or, before any
// is chosen, on a first screen of its own), with Graphite's sections sidebar beside one collapsible card per saved view,
// Graphite-dense rows, j/k keyboard navigation, shareable view lists, and Graphite's section editor in a drawer. Data
// comes through the DataSource; navigation goes through the parent page (src/app/bridge.ts).
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { postToParent } from '../app/bridge';
import type { DataSource } from '../app/data-source';
import { toGitHubUrl, type AppRoute } from '../app/routes';
import type { Organization, PrEnrichment, PrSummary, RepoRef, StackBranches, TopRepository, View, ViewResult } from '../lib/model';
import type { Settings } from '../lib/settings';
import { encodeViewsShareLink, sectionCount } from '../lib/views';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { RelativeTime } from '../ui/RelativeTime';
import { showToast, ToastHost } from '../ui/Toast';
import { GraphiteImport } from './GraphiteImport';
import { importViews } from './import-views';
import { InboxSection, type SectionSort } from './InboxSection';
import { OrgChooser, OrgPicker, useOrganizations } from './OrgPicker';
import { RepoPicker } from './RepoPicker';
import { SectionEditor } from './SectionEditor';
import { SectionsSidebar } from './SectionsSidebar';
import { moveSelection, type SelectedRow } from './selection';
import { ShortcutHelp } from './ShortcutHelp';
import { rowsByStack } from './stacks';
import './inbox.css';

export function InboxPage({ source, route }: { source: DataSource; route: Extract<AppRoute, { page: 'inbox' }> }) {
  const organizations = useOrganizations(source.listOrgs);
  const inbox = useInbox(source, organizations.list);
  const enrichment = useRowEnrichment(source);
  const topRepositories = useTopRepositories(source);
  const moreRows = useMoreRows(source);
  const { settings, org } = inbox;
  const viewerLogin = organizations.list?.find((candidate) => candidate.isViewer)?.login ?? null;
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
  // The open rows' branches, "Load more"'s too, looked up or remembered before grouping by stack shows the rows.
  const stackBranches = useStackBranches(
    source,
    settings?.inboxGroupByStack === true,
    inbox.results?.flatMap((result) => [...result.prs, ...(moreRows.addedTo(result.view, settings?.inboxScope ?? '')?.prs ?? [])]).filter((pr) => pr.state === 'OPEN') ?? [],
  );
  // Each section's rows, those "Load more" added after the first page's, with what enrichment has found, in the order the
  // section shows them, which j / k follow too.
  // Enrichment is asked about rows as GitHub's dashboard gave them, by id: its key follows the dashboard's own CI rollup,
  // which the enriched checks replace on screen, so the row is asked again when the rollup moves on and not before.
  const dashboardRows = new Map<string, PrSummary>();
  const sections =
    inbox.results?.map((result) => {
      const { by, descending } = sorts[result.view.id] ?? LATEST_UPDATED_FIRST;
      const added = moreRows.addedTo(result.view, settings?.inboxScope ?? '')?.prs.filter((pr) => !result.prs.some((first) => first.id === pr.id)) ?? [];
      for (const pr of [...result.prs, ...added]) dashboardRows.set(pr.id, pr);
      const enriched = [...result.prs, ...added].map((pr) => {
        const found = enrichment.found.get(pr.id)?.enrichment;
        const branches = stackBranches.branchesOf(pr.id);
        // The checks found speak for the row whenever there are some: the rollup leaves out GitHub's own dynamic workflow
        // runs (Copilot's review), and a row is asked again once its rollup moves on (`want`). The branches its merge box
        // named are fresher than those looked up or remembered.
        return { ...pr, ...(branches && { baseRefName: branches.baseRefName, headRefName: branches.headRefName ?? '' }), ...found, ci: found?.ci ?? pr.ci };
      });
      const prs = enriched.toSorted((a, b) => {
        const ascending =
          by === 'title' ? a.title.localeCompare(b.title) : by === 'changes' ? a.additions + a.deletions - (b.additions + b.deletions) : Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
        return descending ? -ascending : ascending;
      });
      return { ...result, prs };
    }) ?? [];
  // Grouped by stack, a section shows each stack's rows together, the top first and the others hanging under it (their
  // ids, by view id); a stack joins through a PR another section shows.
  const known = sections.flatMap((result) => result.prs);
  const stackedByView = new Map<string, ReadonlySet<string>>();
  const resultsByView = new Map(
    sections.map((result) => {
      if (!settings?.inboxGroupByStack) return [result.view.id, result];
      const rows = rowsByStack(result.prs, known);
      stackedByView.set(result.view.id, new Set(rows.filter((row) => row.stacked).map((row) => row.pr.id)));
      return [result.view.id, { ...result, prs: rows.map((row) => row.pr) }];
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
      openOnGitHub(pr.url, event.shiftKey);
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
    void inbox
      .saveSettings({ views: exists ? settings.views.map((view) => (view.id === saved.id ? saved : view)) : [...settings.views, saved] })
      .then((done) => done && showToast(exists ? 'Section saved' : 'Section added'));
    setEditing(null);
  }

  function deleteSection(deleted: View) {
    if (!settings || !window.confirm(`Delete the section “${deleted.name}”?`)) return;
    void inbox.saveSettings({ views: settings.views.filter((view) => view.id !== deleted.id) });
    setEditing(null);
  }

  function answerImport(answer: 'replace' | 'append' | 'dismiss') {
    if (settings && pendingImport && answer !== 'dismiss') {
      const count = `${pendingImport.length} ${pendingImport.length === 1 ? 'view' : 'views'}`;
      void inbox
        .saveSettings({ views: importViews(settings.views, pendingImport, answer) })
        .then((done) => done && showToast(answer === 'replace' ? 'Views replaced' : `Imported ${count}`));
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

  function chooseOrg(chosen: Organization, keepViews = false) {
    if (!settings) return;
    setSelected(null);
    // The views saved before views belonged to an organization, kept, take their repositories along (those the
    // organization owns, settings.ts sees to that).
    void inbox.saveSettings({ currentOrg: chosen, ...(keepViews && { views: settings.views, inboxRepos: settings.inboxRepos }) });
  }

  async function importFromGraphite(views: View[], mode: 'replace' | 'append', destination?: { org: Organization; inboxRepos?: RepoRef[] }) {
    setGraphiteOpen(false);
    if (!settings || !org) return;
    // Sections whose repositories all belong to another of the viewer's organizations go there, and the inbox with them.
    const into = destination?.org ?? org;
    const target = into.login === org.login ? settings : await inbox.saveSettings({ currentOrg: into });
    if (!target) return;
    const saved = await inbox.saveSettings({ views: importViews(target.views, views, mode), ...(destination?.inboxRepos && { inboxRepos: destination.inboxRepos }) });
    const count = `${views.length} ${views.length === 1 ? 'view' : 'views'}`;
    if (saved) showToast(mode === 'replace' ? `Views replaced in ${into.login}` : `Imported ${count} into ${into.login}`);
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
          {org && (
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
          )}
          <h1 className="gg-inbox__title">
            <Icon name="logo" className="gg-inbox__logo" />
            Pull requests
          </h1>
          <OrgPicker chip organizations={organizations} current={org} onChange={(chosen) => chooseOrg(chosen)} />
          {org && (
            <RepoPicker
              chip
              selected={settings.inboxRepos}
              emptyLabel="All repositories"
              title={`Every section searches ${settings.inboxRepos.length > 0 ? 'these of' : 'all of'} ${org.login}'s repositories, unless it names repositories of its own`}
              searchRepos={(query) => source.searchRepos(query, org)}
              onChange={(inboxRepos) => void inbox.saveSettings({ inboxRepos })}
            />
          )}
          {org && (
            <label className="gg-inbox__switch" title="Show each stack's pull requests together, the top of the stack first">
              <input type="checkbox" role="switch" checked={settings.inboxGroupByStack} onChange={(event) => void inbox.saveSettings({ inboxGroupByStack: event.target.checked })} />
              <span className="gg-inbox__switch-track" aria-hidden="true" />
              Group by stack
            </label>
          )}
          <div className="gg-inbox__actions">
            {org && (
              <>
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
              </>
            )}
            <Button size="sm" icon="gear" title="Views and other settings" onClick={openOptions}>
              Configure
            </Button>
            <Button variant="ghost" size="sm" icon="question" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setHelpOpen((open) => !open)} />
          </div>
        </div>
      </header>

      {org ? (
        <div className={settings.sidebarCollapsed ? 'gg-inbox__layout is-sidebar-collapsed' : 'gg-inbox__layout'}>
          {(!settings.sidebarCollapsed || sidebarOpen) && (
            <SectionsSidebar
              org={org}
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
              topRepositories={topRepositories}
              onShowMoreRepositories={topRepositories.showMore}
              onOpen={openOnGitHub}
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

            {settings.views.map((view) => {
              const result = resultsByView.get(view.id);
              // GitHub has more rows than shown, until one of its pages comes back empty.
              const more = moreRows.loading.has(view.id)
                ? 'loading'
                : result && result.prs.length < result.totalCount && !moreRows.addedTo(view, settings.inboxScope)?.done
                  ? 'more'
                  : 'none';
              return (
                <div key={view.id} className="gg-inbox__section" data-view-id={view.id}>
                  <InboxSection
                    view={view}
                    result={result}
                    loading={inbox.error === null}
                    sort={sorts[view.id] ?? LATEST_UPDATED_FIRST}
                    selectedPrId={selected?.viewId === view.id ? selected.prId : null}
                    overdueAfterHours={view.id === 'graphite-needs-your-review' ? 48 : undefined}
                    viewerLogin={viewerLogin}
                    enrichmentOf={(pr) => enrichment.found.get(pr.id)?.enrichment}
                    stackedPrIds={stackedByView.get(view.id)}
                    // Until the first lookup of the branches has settled, a section with open rows shows skeleton rows, so
                    // it appears already grouped.
                    awaitingStacks={settings.inboxGroupByStack && !stackBranches.settled && result?.prs.some((pr) => pr.state === 'OPEN') === true}
                    more={more}
                    onSort={(by) => sortSection(view.id, by)}
                    onRowShown={(pr) => enrichment.want(dashboardRows.get(pr.id) ?? pr)}
                    onLoadMore={() => void moreRows.loadMore(view, settings.inboxScope, result?.prs ?? [])}
                    onToggleCollapsed={() => toggleCollapsed(view.id)}
                    onEdit={() => setEditing(view)}
                    onOpen={(pr, newTab) => {
                      setSelected({ viewId: view.id, prId: pr.id });
                      openOnGitHub(pr.url, newTab);
                    }}
                  />
                </div>
              );
            })}
          </main>
        </div>
      ) : (
        <main className="gg-inbox__body">
          <OrgChooser organizations={organizations} viewsUnassigned={settings.viewsUnassigned} onChoose={chooseOrg} />
        </main>
      )}

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      {editing && (
        <SectionEditor
          // The organization's repositories only.
          searchRepos={(query) => source.searchRepos(query, org)}
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
                inbox={org ? { org, repos: settings.inboxRepos, organizations: organizations.list ?? [] } : undefined}
                onImport={(views, mode, destination) => void importFromGraphite(views, mode, destination)}
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
 * Settings, the organization the inbox shows (the one chosen, unless the viewer's organizations, once known, no longer
 * include it) and every view's results for it, kept fresh: refetched when what GitHub is asked changes (not on rename or
 * collapse), every 2 minutes while the tab is visible, and on returning to the tab when older than a minute. Nothing is
 * fetched while no organization is shown.
 */
function useInbox(source: DataSource, organizations: Organization[] | null) {
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

  const chosen = settings?.currentOrg ?? null;
  const org = chosen && (organizations === null || organizations.some((candidate) => candidate.login.toLowerCase() === chosen.login.toLowerCase())) ? chosen : null;

  async function refresh(force: boolean) {
    if (!settings || !org) return;
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

  /** The settings as saved with `patch`; null when they were not, and a toast has said why. */
  async function saveSettings(patch: Partial<Settings>): Promise<Settings | null> {
    try {
      const saved = await source.setSettings(patch);
      setSettings(saved);
      return saved;
    } catch (cause) {
      showToast(`Could not save: ${cause instanceof Error ? cause.message : String(cause)}`, 'danger');
      return null;
    }
  }

  // Another organization's results are no one's to see.
  useEffect(() => {
    setResults(null);
    setFetchedAt(null);
  }, [org?.login]);

  const queriesKey = settings && org && JSON.stringify([settings.inboxScope, settings.views.map(({ id, query, limit }) => [id, query, limit])]);
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

  return { settings, org, results, error, fetchedAt, refreshing, refresh, saveSettings };
}

/**
 * The rows "Load more" has added to each section after its first page, by view id, kept while what the view searches
 * stays the same. Each click asks for the next of GitHub's pages, or, when the view's limit cut the first page short,
 * the first again for the rows it left out; a page that adds nothing new is followed by the next, once; an empty page
 * means there is no more.
 */
function useMoreRows(source: DataSource) {
  const [added, setAdded] = useState<Record<string, { searched: string; nextPage: number; prs: PrSummary[]; done: boolean }>>({});
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set());

  /** What "Load more" has added to `view`, unless what it searches has changed since. */
  function addedTo(view: View, scope: string) {
    const entry = added[view.id];
    return entry?.searched === JSON.stringify([scope, view.query, view.limit]) ? entry : undefined;
  }

  async function loadMore(view: View, scope: string, shown: PrSummary[]) {
    if (loading.has(view.id)) return;
    setLoading((current) => new Set(current).add(view.id));
    const kept = addedTo(view, scope);
    let page = kept?.nextPage ?? (view.limit !== undefined && shown.length >= view.limit ? 1 : 2);
    const found: PrSummary[] = [];
    let done = false;
    try {
      for (let tries = 0; tries < 2 && found.length === 0 && !done; tries += 1, page += 1) {
        const { prs } = await source.fetchInboxPage(view, page);
        done = prs.length === 0;
        found.push(...prs.filter((pr) => !shown.some((other) => other.id === pr.id)));
      }
      setAdded((current) => ({ ...current, [view.id]: { searched: JSON.stringify([scope, view.query, view.limit]), nextPage: page, prs: [...(kept?.prs ?? []), ...found], done } }));
    } catch (cause) {
      showToast(`Could not load more: ${cause instanceof Error ? cause.message : String(cause)}`, 'danger');
    } finally {
      setLoading((current) => {
        const next = new Set(current);
        next.delete(view.id);
        return next;
      });
    }
  }

  return { addedTo, loading, loadMore };
}

/**
 * What GitHub's dashboard leaves out of the rows (mergeability, reviewers, line counts, failing checks), by PR id, asked
 * for as rows come within 200px of view: up to 10 rows a request and one request at a time, so with the content script
 * asking GitHub about 3 PRs at once (and keeping each answer 2 minutes) the inbox never has more than that in flight. A
 * PR is asked again once it has been updated, or its checks have changed, since; an answer that misses something keeps
 * what was found before.
 */
function useRowEnrichment(source: DataSource) {
  const [found, setFound] = useState<ReadonlyMap<string, { updatedAt: string; enrichment: PrEnrichment }>>(new Map());
  const asked = useRef(new Set<string>());
  const queue = useRef<PrSummary[]>([]);
  const asking = useRef(false);

  async function askInTurn() {
    while (queue.current.length > 0) {
      const batch = queue.current.splice(0, 10);
      let answers: PrEnrichment[] = [];
      try {
        answers = await source.enrichInbox(batch.map(({ repo, number, state, isDraft, author, ci }) => ({ repo, number, state, isDraft, author, ci: { state: ci.state } })));
      } catch (error) {
        console.debug('[gg]', 'enriching inbox rows failed; they keep what the dashboard said:', error instanceof Error ? error.message : error);
      }
      setFound((current) => {
        const next = new Map(current);
        batch.forEach((pr, index) => next.set(pr.id, { updatedAt: pr.updatedAt, enrichment: { ...current.get(pr.id)?.enrichment, ...answers[index] } }));
        return next;
      });
    }
    asking.current = false;
  }

  function want(pr: PrSummary) {
    const key = `${pr.id}@${pr.updatedAt}@${pr.ci.state}`;
    if (asked.current.has(key)) return;
    asked.current.add(key);
    queue.current.push(pr);
    if (asking.current) return;
    asking.current = true;
    // Rows that come into view together (the first paint, a section opening, a scroll) share a request.
    setTimeout(() => void askInTurn(), 50);
  }

  return { found, want };
}

/**
 * The open rows' branches, by PR id, by which "Group by stack" chains them before (and whether or not) a row is enriched.
 * What GitHub named is remembered in storage.local (`stackBranches`) for a week after it last did; while `enabled`, GitHub
 * is asked (each PR's page header) about every open row with nothing remembered, or nothing from the last day, 25 rows a
 * request and one request at a time, each row once a page load. `settled` once every open row given so far has its
 * branches, or GitHub had none for it, or 4 s after the first question, whichever comes first; it stays so, and rows given
 * later join their stacks as their branches arrive. Without storage (the harness) nothing is remembered.
 */
function useStackBranches(source: DataSource, enabled: boolean, openRows: PrSummary[]) {
  // Null until the remembered copy has been read; a row GitHub named no branches for maps to null.
  const [found, setFound] = useState<ReadonlyMap<string, StackBranches | null> | null>(null);
  const [firstAskedAt, setFirstAskedAt] = useState<number | null>(null);
  const [settledBefore, setSettledBefore] = useState(false);
  const remembered = useRef<Record<string, StackBranches & { seenAt: string }>>({});
  const asked = useRef(new Set<string>());
  const queue = useRef<PrSummary[]>([]);
  const asking = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      let stored: Array<[string, StackBranches & { seenAt: string }]> = [];
      try {
        const { stackBranches } = await browser.storage.local.get('stackBranches');
        // Branches GitHub has not named for a week belong to pull requests long gone from the inbox.
        stored = Object.entries((stackBranches ?? {}) as Record<string, StackBranches & { seenAt: string }>).filter(([, branches]) => Date.now() - Date.parse(branches.seenAt) < 7 * DAY);
      } catch (error) {
        console.debug('[gg]', 'no branches remembered; every open row is looked up:', error instanceof Error ? error.message : error);
      }
      if (!active) return;
      remembered.current = Object.fromEntries(stored);
      setFound(new Map(stored));
    })();
    return () => {
      active = false;
    };
  }, []);

  async function askInTurn() {
    while (queue.current.length > 0) {
      const batch = queue.current.splice(0, 25);
      let answers: Array<StackBranches | null> = [];
      try {
        answers = await source.branchesOf(batch.map(({ repo, number }) => ({ repo, number })));
      } catch (error) {
        console.debug('[gg]', "looking up inbox rows' branches failed; they wait for their merge boxes:", error instanceof Error ? error.message : error);
      }
      const seenAt = new Date().toISOString();
      batch.forEach((pr, index) => {
        const branches = answers[index];
        if (branches) remembered.current[pr.id] = { ...branches, seenAt };
      });
      // A row GitHub did not answer for keeps what was remembered of it.
      setFound((current) => {
        const next = new Map(current);
        batch.forEach((pr, index) => next.set(pr.id, answers[index] ?? next.get(pr.id) ?? null));
        return next;
      });
      try {
        await browser.storage.local.set({ stackBranches: remembered.current });
      } catch (error) {
        console.debug('[gg]', 'the branches looked up could not be remembered:', error instanceof Error ? error.message : error);
      }
    }
    asking.current = false;
  }

  const askAboutRows = useEffectEvent(() => {
    if (!found) return;
    const wanted: PrSummary[] = [];
    for (const pr of openRows) {
      const seenAt = remembered.current[pr.id]?.seenAt;
      if (asked.current.has(pr.id) || (seenAt !== undefined && Date.now() - Date.parse(seenAt) < DAY)) continue;
      asked.current.add(pr.id);
      wanted.push(pr);
    }
    if (wanted.length === 0) return;
    queue.current.push(...wanted);
    setFirstAskedAt((at) => at ?? Date.now());
    if (asking.current) return;
    asking.current = true;
    void askInTurn();
  });
  const openKey = openRows.map((pr) => pr.id).join(' ');
  useEffect(() => {
    if (enabled) askAboutRows();
  }, [enabled, openKey, found === null]);

  // Every open row given so far has its branches, or GitHub had none for it.
  const answered = found !== null && openRows.length > 0 && openRows.every((pr) => found.has(pr.id));
  useEffect(() => {
    if (answered) setSettledBefore(true);
  }, [answered]);
  // A slow GitHub holds the rows back 4 s at most.
  useEffect(() => {
    if (firstAskedAt === null) return;
    const timer = setTimeout(() => setSettledBefore(true), Math.max(0, firstAskedAt + 4000 - Date.now()));
    return () => clearTimeout(timer);
  }, [firstAskedAt]);

  return { branchesOf: (prId: string) => found?.get(prId) ?? undefined, settled: settledBefore || answered };
}

/**
 * The repositories GitHub's homepage lists under "Top repositories": the first page as the inbox opens, then each page
 * "Show more" asks for, appended. A failure keeps what is shown, with GitHub's reason for the sidebar to say.
 */
function useTopRepositories(source: DataSource) {
  const [repos, setRepos] = useState<TopRepository[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(cursor: number | null) {
    setLoading(true);
    try {
      const page = await source.listTopRepositories(cursor);
      setRepos((shown) => [...shown, ...page.repos.filter((repo) => !shown.some((other) => other.url === repo.url))]);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(null);
  }, [source]);

  return {
    repos,
    canShowMore: nextCursor !== null,
    loading,
    error,
    showMore: () => {
      if (!loading && nextCursor !== null) void load(nextCursor);
    },
  };
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

const DAY = 24 * 60 * 60 * 1000;

/**
 * Opens a page on GitHub (a PR, a repository, the organization) the way a link would: the github.com page navigates (or
 * opens a tab); the standalone harness opens a tab.
 */
function openOnGitHub(url: string, newTab: boolean) {
  if (window.parent === window) window.open(url, '_blank');
  else postToParent({ type: 'gg:navigate', url, newTab });
}
