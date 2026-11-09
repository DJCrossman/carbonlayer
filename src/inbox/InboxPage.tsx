// The inbox (the github.com homepage): one organization's pull requests at a time, chosen in the top bar (or, before any
// is chosen, on a first screen of its own), with Graphite's sections sidebar beside one collapsible card per saved view,
// Graphite-dense rows, j/k keyboard navigation, Linear's copy shortcuts for the row under the pointer, shareable view
// lists, and Graphite's section editor in a drawer. Data comes through the DataSource; navigation goes through the
// parent page (src/app/bridge.ts).
import { useInfiniteQuery, useQueries, useQueryClient, type Query, type QueryClient } from '@tanstack/react-query';
import { useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { z } from 'zod/mini';
import { askedTogether } from '../app/asked-together';
import { postToParent } from '../app/bridge';
import { COPY_KEYBINDINGS, copyPullRequest } from '../app/copy-pull-request';
import type { DataSource } from '../app/data-source';
import { SaveCacheNow } from '../app/query-cache';
import { toGitHubUrl, type AppRoute } from '../app/routes';
import { useSettings } from '../app/use-settings';
import { prStagesSchema, viewResultSchema, type GraphiteStackPlace, type Organization, type PrSummary, type RepoRef, type StackBranches, type StackEntry, type TopRepository, type View, type ViewResult } from '../lib/model';
import type { Settings } from '../lib/settings';
import { encodeViewsShareLink, sectionCount } from '../lib/views';
import { createChordReader } from '../pr/keybindings';
import { prStageQuery, useLoadAhead } from '../pr/page-data';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { RelativeTime } from '../ui/RelativeTime';
import { showToast, ToastHost } from '../ui/Toast';
import { GraphiteImport } from './GraphiteImport';
import { importViews } from './import-views';
import { InboxSection, type SectionSort } from './InboxSection';
import { OrgChooser, OrgPicker, useOrganizations } from './OrgPicker';
import { RepoPicker } from './RepoPicker';
import { useRowEnrichment } from './row-details';
import { SectionEditor } from './SectionEditor';
import { SectionsSidebar } from './SectionsSidebar';
import { moveSelection, type SelectedRow } from './selection';
import { ShortcutHelp } from './ShortcutHelp';
import { isSamePr, rowsWithStacks, stackPlaces } from './stacks';
import './inbox.css';

export function InboxPage({ source, route }: { source: DataSource; route: Extract<AppRoute, { page: 'inbox' }> }) {
  const queryClient = useQueryClient();
  const organizations = useOrganizations(source.listOrgs);
  const inbox = useInbox(source, organizations.list);
  const topRepositories = useTopRepositories(source, inbox.org, inbox.settings?.inboxRepos ?? NO_REPOS);
  const moreRows = useMoreRows(source, inbox.org);
  const { settings, org } = inbox;
  // Each section's rows the way GitHub's dashboard gave them: its first page, then those "Load more" added. A section
  // that could not load says why in place of its rows, those "Load more" added before too.
  const dashboard = inbox.results.map((result) => ({
    result,
    added: result.error ? [] : (moreRows.addedTo(result.view, settings?.inboxScope ?? '')?.prs.filter((pr) => !result.prs.some((first) => first.id === pr.id)) ?? []),
  }));
  // Enrichment is asked about rows the way GitHub's dashboard gave them, by id: its key follows the dashboard's own CI
  // rollup, which the enriched checks replace on screen, so the row is asked again when the rollup moves on and not before.
  const dashboardRows = new Map(dashboard.flatMap(({ result, added }) => [...result.prs, ...added].map((pr) => [pr.id, pr] as const)));
  // Where Graphite's stack comment places each row, merged and closed ones too, for the chip of a stack Graphite manages:
  // grouped by stack, every open row's up front, else each row's as it shows.
  const graphiteStacks = useGraphiteStacks(source, [...dashboardRows.values()], settings?.inboxGroupByStack === true);
  // Grouped by stack, the stacks of the open rows that are in one, as their PR pages' stack stage answers them.
  const inboxStacks = useInboxStacks(source, [...dashboardRows.values()], graphiteStacks.found, settings?.inboxGroupByStack === true);
  const enrichment = useRowEnrichment(source, [...dashboardRows.values()], settings?.mergeMethod ?? 'MERGE');
  const loadAhead = useLoadAhead(source);
  const saveCacheNow = useContext(SaveCacheNow);
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
  // Each section's open rows' branches, "Load more"'s too, looked up or remembered before grouping by stack shows the rows,
  // which wait for their Graphite places and, those in a stack, for their stacks too.
  const stackBranches = useStackBranches(
    source,
    settings?.inboxGroupByStack === true,
    dashboard.map(({ result, added }) => ({ viewId: result.view.id, openRows: [...result.prs, ...added].filter((pr) => pr.state === 'OPEN') })),
    // A row in one of GitHub's own stacks has no Graphite place to wait for, and a row in no stack no stack.
    (pr) =>
      (pr.nativeStack !== null || graphiteStacks.answered.has(pr.id)) &&
      ((pr.nativeStack === null && (graphiteStacks.found.get(pr.id)?.size ?? 0) <= 1) || inboxStacks.answered.has(pr.id)),
  );
  // Each section's rows, those "Load more" added after the first page's, with what enrichment has found, in the order the
  // section shows them, which j / k follow too.
  const sections = dashboard.map(({ result, added }) => {
    const { by, descending } = sorts[result.view.id] ?? LATEST_UPDATED_FIRST;
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
  });
  // Every row the inbox has, in any section: where each sits in its stack is found among them, so a stack joins through a
  // PR another section shows, and grouped by stack or not, a stack GitHub doesn't track gets a chip from it.
  const inboxRows = sections.flatMap((result) => result.prs);
  const places = stackPlaces(inboxRows);
  // Grouped by stack, a section shows each stack's rows together, the top first and the others hanging under it (their
  // ids, by view id), with the stack's PRs it does not list as condensed context rows (where each sits in its stack, by
  // id, by view id), which j / k, the copy keys and a click reach as any row.
  const stackedByView = new Map<string, ReadonlySet<string>>();
  const contextByView = new Map<string, ReadonlyMap<string, { position: number; size: number }>>();
  const resultsByView = new Map<string, Omit<ViewResult, 'prs'> & { prs: Array<PrSummary | StackEntry> }>(
    sections.map((result) => {
      if (!settings?.inboxGroupByStack) return [result.view.id, result];
      const rows = rowsWithStacks(result.prs, inboxRows, places, inboxStacks.found, { merged: settings.stackShowMerged, closed: settings.stackShowClosed });
      stackedByView.set(result.view.id, new Set(rows.filter((row) => row.stacked).map((row) => row.pr.id)));
      contextByView.set(result.view.id, new Map(rows.flatMap((row) => (row.context ? [[row.pr.id, row.context] as const] : []))));
      return [result.view.id, { ...result, prs: rows.map((row) => row.pr) }];
    }),
  );
  const firstResult = settings?.views[0] && resultsByView.get(settings.views[0].id);
  // The row j / k selected is the one the viewer may open next.
  const selectedPr = selected && resultsByView.get(selected.viewId)?.prs.find((candidate) => candidate.id === selected.prId);
  useEffect(() => {
    if (selectedPr) loadAhead(selectedPr);
  }, [selectedPr?.id]);
  const toReview = firstResult && !firstResult.error ? sectionCount(firstResult) : undefined;

  // From the first frame, so a move here inside the app does not keep the last page's title.
  useEffect(() => {
    const title = toReview === undefined ? 'Pull requests' : `Pull requests · ${toReview} to review`;
    document.title = title;
    postToParent({ type: 'gg:title', title });
  }, [toReview]);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))) return;
    const copy = readCopyKey(event);
    if (copy !== null && copy !== 'pending') {
      // The row under the pointer, else the one selected. With neither, or for ⌘C with text selected, the key stays the
      // browser's.
      const row = document.querySelector('.gg-row:hover');
      const section = row?.closest('[data-view-id]');
      const at = row instanceof HTMLElement && row.dataset.prId ? { viewId: (section instanceof HTMLElement ? section.dataset.viewId : undefined) ?? '', prId: row.dataset.prId } : selected;
      const pr = at && resultsByView.get(at.viewId)?.prs.find((candidate) => candidate.id === at.prId);
      if (!pr || (copy.action === 'copy-title-link' && document.getSelection()?.type === 'Range')) return;
      event.preventDefault();
      void copyPullRequest(pr, copy.action);
      return;
    }
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
      if (!selectedPr) return;
      openPr(selectedPr, event.shiftKey);
    } else if (event.key === 'r') {
      inbox.refresh();
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

  /** Opens a PR's page once what the inbox loaded for it is saved, so the page finds it. */
  function openPr(pr: PrSummary | StackEntry, newTab: boolean) {
    void saveCacheNow().finally(() => openOnGitHub(pr.url, newTab));
  }

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
              searchRepos={(query) => searchRepos(queryClient, source, query, org)}
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
                  onClick={inbox.refresh}
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
              // The rows the section lists itself, without the context rows grouping by stack adds, which "Load more" goes on from.
              const listed = sections.find((section) => section.view.id === view.id)?.prs ?? [];
              // GitHub has more rows than shown, until one of its pages comes back empty.
              const more = moreRows.loading.has(view.id)
                ? 'loading'
                : result && listed.length < result.totalCount && !moreRows.addedTo(view, settings.inboxScope)?.done
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
                    contextPlaces={contextByView.get(view.id)}
                    stackPlaces={places}
                    graphiteStackPlaces={graphiteStacks.found}
                    // Until its open rows' branches, places and stacks are known, a section shows skeleton rows, so it appears
                    // already grouped, its context rows with it.
                    awaitingStacks={stackBranches.awaiting(view.id)}
                    more={more}
                    onSort={(by) => sortSection(view.id, by)}
                    onRowShown={(pr) => {
                      const row = dashboardRows.get(pr.id) ?? pr;
                      enrichment.want(row);
                      graphiteStacks.want(row);
                    }}
                    onRowIntent={loadAhead}
                    onLoadMore={() => void moreRows.loadMore(view, settings.inboxScope, listed)}
                    onToggleCollapsed={() => toggleCollapsed(view.id)}
                    onEdit={() => setEditing(view)}
                    onOpen={(pr, newTab) => {
                      setSelected({ viewId: view.id, prId: pr.id });
                      openPr(pr, newTab);
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
          searchRepos={(query) => searchRepos(queryClient, source, query, org)}
          // An organization's people change slowly: kept 10 minutes.
          listPeople={async () =>
            org ? queryClient.fetchQuery({ queryKey: ['org-people', org.login], queryFn: () => source.listOrgPeople(org), staleTime: 10 * 60_000 }) : []
          }
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
 * The settings (as the page last read them, useSettings), the organization the inbox shows (the one chosen, unless the
 * viewer's organizations, once known, no longer include it) and every view's results for it, a query a section, kept by
 * what GitHub is asked (not a rename or a collapse): what the cache had for the organization shows at once, then GitHub is
 * asked, the open sections first and the folded ones, which show only a count until opened, once those have answered;
 * again every 2 minutes while the tab shows, and on coming back to it once 30 s old (src/app/query-cache.tsx). Nothing is
 * fetched while no organization is shown.
 */
function useInbox(source: DataSource, organizations: Organization[] | null) {
  const queryClient = useQueryClient();
  const { settings, error: settingsError, show: showSettings } = useSettings(source);

  const chosen = settings?.currentOrg ?? null;
  const org = chosen && (organizations === null || organizations.some((candidate) => candidate.login.toLowerCase() === chosen.login.toLowerCase())) ? chosen : null;
  const views = settings && org ? settings.views : [];
  // Sections asked for in the same moment are one request; the content script asks GitHub about three at a time.
  const askForSection = useMemo(() => askedTogether((asked: View[]) => source.fetchInbox(asked), { perRequest: Infinity, atOnce: Infinity }), [source]);
  // The organization whose open sections have answered on this page, so its folded ones may be asked.
  const [openAnswered, setOpenAnswered] = useState<string | null>(null);
  const sections = useQueries({
    queries: views.map((view) => ({
      queryKey: ['inbox', org?.login, settings?.inboxScope, view.id, view.query, view.limit],
      queryFn: () => askForSection(view),
      // Opening the inbox asks GitHub, whatever the cache had.
      refetchOnMount: 'always' as const,
      staleTime: 30_000,
      refetchInterval: 120_000,
      enabled: !view.collapsed || openAnswered === org?.login,
      // A section whose search changed (the repositories chosen, its query or limit) shows its last answer for the
      // organization until GitHub answers the new one.
      placeholderData: () =>
        z.optional(viewResultSchema).parse(
          queryClient
            .getQueryCache()
            .findAll({ queryKey: ['inbox', org?.login], predicate: ({ queryKey, state }) => queryKey[3] === view.id && state.data !== undefined })
            .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)[0]?.state.data,
        ),
    })),
  });
  useEffect(() => {
    if (org && openAnswered !== org.login && views.every((view, index) => view.collapsed || sections[index]?.isFetchedAfterMount)) setOpenAnswered(org.login);
  });

  // Every section that has answered, now or before (the cache), under its view as it is now: a rename shows at once.
  const results: ViewResult[] = views.flatMap((view, index) => {
    const data = sections[index]?.data;
    return data ? [{ ...data, view }] : [];
  });
  const answeredAt = sections.flatMap((section) => (section.data && !section.isPlaceholderData ? [section.dataUpdatedAt] : []));
  // Signed out, or with the content script not answering, every section fails: the page says so once, over what it shows.
  const failed = sections.find((section) => section.isError);

  /** The settings as saved with `patch`; null when they were not, and a toast has said why. */
  async function saveSettings(patch: Partial<Settings>): Promise<Settings | null> {
    try {
      const saved = await source.setSettings(patch);
      showSettings(saved);
      return saved;
    } catch (cause) {
      showToast(`Could not save: ${cause instanceof Error ? cause.message : String(cause)}`, 'danger');
      return null;
    }
  }

  return {
    settings,
    org,
    results,
    error: settingsError ?? failed?.error?.message ?? null,
    fetchedAt: answeredAt.length > 0 ? Math.min(...answeredAt) : null,
    refreshing: sections.some((section) => section.isFetching),
    /** Asks GitHub again for every section of the organization shown, each showing what it has meanwhile. */
    refresh: () => void queryClient.invalidateQueries({ queryKey: ['inbox', org?.login] }),
    saveSettings,
  };
}

/**
 * The rows "Load more" has added to each section after its first page, by view id, kept while what the view searches
 * stays the same. Each click asks for the next of GitHub's pages (a query of its own, kept 30 s), or, when the view's
 * limit cut the first page short, the first again for the rows it left out; a page that adds nothing new is followed by
 * the next, once; an empty page means there is no more.
 */
function useMoreRows(source: DataSource, org: Organization | null) {
  const queryClient = useQueryClient();
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
        const asked = page;
        const { prs } = await queryClient.fetchQuery({
          queryKey: ['inbox-page', org?.login, scope, view.query, view.limit, asked],
          queryFn: () => source.fetchInboxPage(view, asked),
          staleTime: 30_000,
        });
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
 * The open rows' branches, by PR id, by which "Group by stack" chains them before (and whether or not) a row is enriched,
 * and which sections wait for their stacks: a query a PR. While `enabled`, GitHub is asked (each PR's page header) about
 * every open row the cache has nothing for: 25 rows a request and up to three requests at once, the rows of the sections
 * higher up first (`sections` comes in their order). A PR's branches do not change, so once GitHub has named them they
 * are kept until the cache lets them go (a day); a row GitHub named none for is asked again on the next page load. A
 * section is `awaiting` until each of its open rows has its branches, or GitHub had none for it, and its stack is known
 * (`stackKnown`: its Graphite place answered and, in a stack, its stack too), or 15 s after its rows were first asked
 * about, whichever comes first, so that its context rows show with it; once shown it stays so, and rows that join it
 * later join their stacks as their branches and stacks arrive.
 */
function useStackBranches(source: DataSource, enabled: boolean, sections: Array<{ viewId: string; openRows: PrSummary[] }>, stackKnown: (pr: PrSummary) => boolean) {
  // When each section's rows were first asked about, and the sections shown since, by view id.
  const [askedAt, setAskedAt] = useState<ReadonlyMap<string, number>>(new Map());
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const askForBranches = useMemo(
    () => askedTogether((prs: PrSummary[]) => source.branchesOf(prs.map(({ repo, number }) => ({ repo, number }))), { perRequest: 25, atOnce: 3 }),
    [source],
  );
  const rows = [...new Map(sections.flatMap((section) => section.openRows.map((pr) => [pr.id, pr] as const))).values()];
  // A row GitHub named branches for, or none for (null), or that it did not answer for (null, unless the cache had some).
  const found = useQueries({
    queries: rows.map((pr) => ({
      queryKey: ['stack-branches', pr.repo.owner, pr.repo.name, pr.number],
      queryFn: () => askForBranches(pr),
      staleTime: (query: Query<StackBranches | null>) => (query.state.data ? Infinity : 0),
      refetchOnWindowFocus: false,
      enabled,
    })),
    combine: (results) => new Map(rows.flatMap((pr, index) => (results[index]?.data !== undefined || results[index]?.isError ? [[pr.id, results[index]?.data ?? null] as const] : []))),
  });

  // Branches were kept in storage.local before the page's cache kept them; that copy goes.
  useEffect(() => {
    browser?.storage?.local.remove('stackBranches').catch(() => {});
  }, []);

  // The sections with an open row whose branches or stack are not answered yet, by view id.
  const unanswered = sections.flatMap(({ viewId, openRows }) => (openRows.every((pr) => found.has(pr.id) && stackKnown(pr)) ? [] : [viewId]));
  // A section with rows not answered yet, asked about now or before for another section, waits 15 s at most from now.
  const startWaiting = useEffectEvent(() => {
    const waiting = unanswered.filter((viewId) => !askedAt.has(viewId));
    if (waiting.length > 0) setAskedAt((at) => new Map([...waiting.map((viewId) => [viewId, Date.now()] as const), ...at]));
  });
  // A section shown once stays shown, whatever rows join it later.
  const keepShown = useEffectEvent(() => {
    if (!enabled) return;
    const answered = sections.filter(({ viewId }) => !shown.has(viewId) && !unanswered.includes(viewId));
    if (answered.length > 0) setShown((ids) => new Set([...ids, ...answered.map(({ viewId }) => viewId)]));
  });
  const sectionsKey = sections.map(({ viewId, openRows }) => `${viewId}:${openRows.map((pr) => pr.id).join(',')}`).join(' ');
  useEffect(() => {
    if (enabled) startWaiting();
  }, [enabled, sectionsKey]);
  useEffect(() => keepShown(), [enabled, sectionsKey, unanswered.join(' ')]);

  // A slow GitHub holds a section's rows back 15 s at most: its branches, places and stacks are asked one after the other.
  useEffect(() => {
    const timers = [...askedAt].map(([viewId, at]) => setTimeout(() => setShown((ids) => (ids.has(viewId) ? ids : new Set(ids).add(viewId))), Math.max(0, at + 15_000 - Date.now())));
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [askedAt]);

  return {
    branchesOf: (prId: string) => found.get(prId) ?? undefined,
    awaiting: (viewId: string) => enabled && !shown.has(viewId) && unanswered.includes(viewId),
  };
}

/**
 * Where Graphite's stack comment on each row's page places it, by PR id (`found`), and the rows its page has answered for,
 * a place, none or a failure (`answered`), for the chip of a stack Graphite manages and, grouped by stack, for the
 * sections waiting for their stacks: a query a PR, open, merged and closed rows alike (Graphite's inbox gives each its
 * chip), except a row in one of GitHub's own stacks, whose chip GitHub's place gives. Grouped by stack (`grouped`), an
 * open row is asked as soon as it is known, the rows of the sections higher up first (`rows` comes in their order); a
 * merged or closed row, and every row otherwise, once it comes within 200px of view. Rows asked together share a
 * request, 10 rows a request and one request at a time, the content script reading three of their pages at once. A PR's
 * stack seldom changes, so what its page said, a place or none, is asked again only once the row has been updated since,
 * and is kept until the cache lets it go (a day); a page GitHub did not answer is asked again the next time the row shows.
 */
function useGraphiteStacks(source: DataSource, rows: PrSummary[], grouped: boolean) {
  // The rows shown so far, as they were when shown (by id and when GitHub last updated them).
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const askForPlace = useMemo(
    () => askedTogether((prs: PrSummary[]) => source.graphiteStacksOf(prs.map(({ repo, number }) => ({ repo, number }))), { perRequest: 10, atOnce: 1, gatherMs: 50 }),
    [source],
  );
  const { found, answered } = useQueries({
    queries: rows.map((pr) => ({
      queryKey: ['graphite-stack', pr.repo.owner, pr.repo.name, pr.number],
      queryFn: () => askForPlace(pr),
      // What was found before the row's latest update, or not answered, is asked again; the place found meanwhile stays on the row.
      staleTime: (query: Query<{ place: GraphiteStackPlace | null } | null>) => (query.state.data && query.state.dataUpdatedAt >= Date.parse(pr.updatedAt) ? Infinity : 0),
      refetchOnWindowFocus: false,
      enabled: pr.nativeStack === null && ((grouped && pr.state === 'OPEN') || shown.has(`${pr.id} ${pr.updatedAt}`)),
    })),
    combine: (results) => ({
      found: new Map(
        rows.flatMap((pr, index) => {
          const place = results[index]?.data?.place;
          return place ? [[pr.id, place] as const] : [];
        }),
      ),
      answered: new Set(rows.flatMap((pr, index) => (results[index]?.data !== undefined || results[index]?.isError ? [pr.id] : []))),
    }),
  });

  function want(pr: PrSummary) {
    const version = `${pr.id} ${pr.updatedAt}`;
    if (!shown.has(version)) setShown((current) => new Set(current).add(version));
  }

  return { found, answered, want };
}

/**
 * Grouped by stack (`enabled`), the stack of each open row that is in one (one of GitHub's own, or Graphite's stack
 * comment places it among two or more), as its PR page's stack stage answers it (`found`), and the rows whose stack is
 * answered or already listed by another's (`answered`), for the sections waiting for their stacks: under the page's own
 * key, so the PR page opens with it, and a stack a PR page fetched shows here at once. Only an answer whose line lists
 * its own row counts, and only the line: the forks stay out, as the inbox's chip leaves them out. A row is asked as soon
 * as it is known to be in a stack, whether or not it shows, in the order of `rows` (the sections higher up first); a
 * merged or closed row never, as it joins no stack's group. The stage costs the PR's page and, for Graphite's stack, a
 * request or two for each of its PRs, so it is asked sparingly: not for a row a stack known for a row before it already
 * lists, and three rows at a time, the next row no answered stack lists following as each answers, so that a stack's
 * other rows mostly find its answer first; an answer is kept 2 minutes, and not asked again on coming back to the tab.
 */
function useInboxStacks(source: DataSource, rows: PrSummary[], graphitePlaces: ReadonlyMap<string, GraphiteStackPlace>, enabled: boolean) {
  const queryClient = useQueryClient();
  const inStacks = enabled ? rows.filter((pr) => pr.state === 'OPEN' && (pr.nativeStack !== null || (graphitePlaces.get(pr.id)?.size ?? 0) > 1)) : [];
  // What the cache has for each (read by its stage's schema): its stack, when the line lists the row, and whether GitHub
  // has answered at all.
  const cached = inStacks.map((pr) => {
    const state = queryClient.getQueryState(prStageQuery(source, pr.repo, pr.number, 'stack').queryKey);
    const stack = z.optional(prStagesSchema.shape.stack).parse(state?.data)?.stack;
    return { pr, stack: stack?.entries.some((entry) => isSamePr(entry, pr)) ? stack : undefined, answered: state?.data !== undefined || state?.status === 'error' };
  });
  const covered = cached.map(({ pr }, index) => cached.slice(0, index).some(({ stack }) => stack?.entries.some((entry) => isSamePr(entry, pr))));
  // The first three rows neither answered nor listed by an answered stack, which are asked now.
  const next = cached.flatMap(({ answered }, index) => (!answered && !covered[index] ? [index] : [])).slice(0, 3);
  const results = useQueries({
    queries: cached.map(({ pr, answered }, index) => ({
      ...prStageQuery(source, pr.repo, pr.number, 'stack'),
      staleTime: 2 * 60_000,
      refetchOnWindowFocus: false,
      enabled: !covered[index] && (answered || next.includes(index)),
    })),
  });
  // Each query's status is read here (pending until it has data), so that the page renders again, and the next row is
  // asked, once one asked before it has answered or failed, whatever it said.
  const found = results.flatMap((result, index) => {
    const pr = cached[index]?.pr;
    const stack = result.status === 'pending' ? undefined : result.data?.stack;
    return pr && stack && stack.entries.length > 1 && stack.entries.some((entry) => isSamePr(entry, pr)) ? [stack] : [];
  });

  return { found, answered: new Set(cached.flatMap(({ pr, answered }, index) => (answered || covered[index] ? [pr.id] : []))) };
}

/**
 * The repositories under the sections, for the organization the inbox shows: the repositories chosen in its picker when
 * the inbox searches only those, else GitHub's own "Top repositories", which span every owner, narrowed to the
 * organization. GitHub's list is read a page at a time (kept 10 minutes) until a page's worth of the organization's
 * repositories shows, the list ends, or six pages have been read for nothing; "Show more" asks for the next page's worth
 * the same way. A failure keeps what is shown, with GitHub's reason for the sidebar to say.
 */
function useTopRepositories(source: DataSource, org: Organization | null, chosen: RepoRef[]) {
  // How many of the organization's repositories to show, and how many of GitHub's pages may be read to find them.
  const [wanted, setWanted] = useState({ repos: REPOSITORIES_PAGE, pages: 6 });
  const owner = org?.login.toLowerCase() ?? null;
  const pages = useInfiniteQuery({
    queryKey: ['top-repositories'],
    // The first page has no cursor; each later one, the cursor the page before it named.
    queryFn: ({ pageParam }: { pageParam: number | null }) => source.listTopRepositories(pageParam),
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 10 * 60_000,
    enabled: chosen.length === 0 && owner !== null,
  });
  const fetched = (pages.data?.pages ?? []).flatMap((page) => page.repos).filter((repo, index, all) => all.findIndex((other) => other.url === repo.url) === index);
  const ofOrganization = fetched.filter((repo) => repo.owner.toLowerCase() === owner);
  const read = pages.data?.pages.length ?? 0;

  // Another organization starts from a page's worth again; what GitHub answered still holds.
  useEffect(() => {
    setWanted({ repos: REPOSITORIES_PAGE, pages: read + 6 });
  }, [owner]);

  useEffect(() => {
    if (chosen.length > 0 || !owner || !pages.hasNextPage || pages.isFetching || pages.isError) return;
    if (read < wanted.pages && ofOrganization.length < wanted.repos) void pages.fetchNextPage();
  }, [chosen.length, owner, pages.hasNextPage, pages.isFetching, pages.isError, read, wanted, ofOrganization.length]);

  if (chosen.length > 0) {
    return {
      repos: chosen.map((repo): TopRepository => ({
        owner: repo.owner,
        name: repo.name,
        url: `https://github.com/${repo.owner}/${repo.name}`,
        avatarUrl:
          fetched.find((known) => known.owner.toLowerCase() === repo.owner.toLowerCase())?.avatarUrl ??
          (org && org.login.toLowerCase() === repo.owner.toLowerCase() && org.avatarUrl ? org.avatarUrl : null),
      })),
      canShowMore: false,
      loading: false,
      error: null,
      showMore: () => {},
    };
  }
  return {
    repos: ofOrganization.slice(0, wanted.repos),
    canShowMore: ofOrganization.length > wanted.repos || pages.hasNextPage,
    loading: pages.isFetching || (pages.data === undefined && !pages.isError),
    error: pages.error?.message ?? null,
    showMore: () => {
      if (pages.isFetching) return;
      setWanted((current) => ({ repos: current.repos + REPOSITORIES_PAGE, pages: read + 6 }));
    },
  };
}

/** How many of an organization's repositories the sidebar shows at first, and adds with "Show more". */
const REPOSITORIES_PAGE = 7;

/** No repositories chosen, as one list, so the sidebar's repositories are not worked out again for nothing. */
const NO_REPOS: RepoRef[] = [];

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
      const sections = [...document.querySelectorAll('[data-view-id]')].filter((section) => section instanceof HTMLElement);
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


/**
 * Opens a page on GitHub (a PR, a repository, the organization) the way a link would: the github.com page navigates (or
 * opens a tab); the standalone harness opens a tab.
 */
function openOnGitHub(url: string, newTab: boolean) {
  if (window.parent === window) window.open(url, '_blank');
  else postToParent({ type: 'gg:navigate', url, newTab });
}

/** Reads ⌘. / ⌘C / ⌘, (Ctrl off macOS), which copy a row's PR. */
const readCopyKey = createChordReader(COPY_KEYBINDINGS, { isMac: navigator.userAgent.includes('Mac') });

/**
 * The organization's repositories GitHub's picker offers for what was typed: what the top bar's and the section editor's
 * pickers list. The picker asks again after every pause in typing; what it asked in the last minute is answered from the
 * cache.
 */
function searchRepos(queryClient: QueryClient, source: DataSource, query: string, org: Organization | null) {
  return queryClient.fetchQuery({ queryKey: ['repos', org?.login, query.trim()], queryFn: () => source.searchRepos(query, org), staleTime: 60_000 });
}
