// User settings, synced through browser.storage.sync. Usable from the content script, the app,
// options and popup (all have the `storage` permission). There is no token: GitHub's session is used.
// The inbox shows one organization at a time (`currentOrg`), and each organization has its own views, sidebar order and
// repositories. Synced storage holds at most 8 KB an item and 100 KB in all, and one view with a Graphite filter can take
// 2 KB, so each view is an item of its own (`view:<org>/<id>`), and the `settings` item holds the rest: each
// organization's views' order (`viewsByOrg`) and repositories (`reposByOrg`). An organization nobody has changed the
// views of has Graphite's defaults, stored nowhere. Views saved before views belonged to an organization (`view:<id>`,
// ordered by `viewOrder`, with `inboxRepos` / `inboxScope`) stay until the first organization is chosen, which keeps them
// or not.

import { browser } from 'wxt/browser';
import { z } from 'zod';
import { mergeMethodSchema, organizationSchema, repoRefSchema, viewSchema, type Organization, type RepoRef, type View } from './model';
import { DEFAULT_VIEWS, organizationScope, repositoryScope } from './views';

export interface Settings {
  /** The account whose pull requests the inbox shows; null until one is chosen. */
  currentOrg: Organization | null;
  /**
   * The current organization's views, in its sidebar's order. Before one is chosen, the views saved before views belonged
   * to an organization, or Graphite's defaults.
   */
  views: View[];
  /** Whether `views` were saved before views belonged to an organization: the first organization chosen may keep them. */
  viewsUnassigned: boolean;
  /**
   * Prepended to every view query: the current organization's chosen `inboxRepos` as one `(repo:a OR repo:b)`, else the
   * whole organization (`org:acme`, or `user:octocat` for the viewer's own account). Before an organization is chosen,
   * what an earlier version saved.
   */
  inboxScope: string;
  /** The repositories of the current organization the inbox searches, as chosen in the repository picker (empty: all of them). */
  inboxRepos: RepoRef[];
  /** Whether the inbox's sections sidebar is hidden (on a wide window; a narrow one shows it on demand). */
  sidebarCollapsed: boolean;
  /** Whether each inbox section shows a stack's pull requests together, the top of the stack first. */
  inboxGroupByStack: boolean;
  inboxEnabled: boolean;
  prEnabled: boolean;
  diffLayout: 'unified' | 'split';
  theme: 'auto' | 'light' | 'dark';
  mergeMethod: 'MERGE' | 'SQUASH' | 'REBASE';
}

export const DEFAULT_SETTINGS: Settings = {
  currentOrg: null,
  views: DEFAULT_VIEWS,
  viewsUnassigned: false,
  inboxScope: '',
  inboxRepos: [],
  sidebarCollapsed: false,
  inboxGroupByStack: false,
  inboxEnabled: true,
  prEnabled: true,
  diffLayout: 'unified',
  theme: 'auto',
  mergeMethod: 'SQUASH',
};

/** Where settings live: Chrome's synced storage, or the dev harness's memory. */
export interface SettingsStorage {
  get(keys: null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export async function getSettings(storage: SettingsStorage = browser.storage.sync): Promise<Settings> {
  const sync = await storage.get(null);
  const { views: unsplitViews, viewOrder, viewsByOrg, reposByOrg, inboxRepos: reposBeforeOrgs, inboxScope: scopeBeforeOrgs, currentOrg, ...preferences } = storedSettingsSchema.parse(
    sync.settings ?? {},
  );
  if (currentOrg) {
    // A view this version cannot read is left out.
    const views = viewsByOrg?.[currentOrg.login]?.viewOrder.flatMap((id) => viewSchema.safeParse(sync[`view:${currentOrg.login}/${id}`]).data ?? []);
    const inboxRepos = reposByOrg?.[currentOrg.login] ?? [];
    return { ...DEFAULT_SETTINGS, ...preferences, currentOrg, views: views ?? DEFAULT_VIEWS, viewsUnassigned: false, inboxRepos, inboxScope: organizationScope(currentOrg, inboxRepos) };
  }

  // No organization chosen yet: the views and repositories saved before views belonged to one.
  // Settings saved before the repository picker name the inbox's repositories only in the scope's text; a scope of
  // nothing but repositories is those repositories chosen.
  const named = [...(scopeBeforeOrgs ?? '').matchAll(/(?:^|[\s(])repo:([^\s/()]+)\/([^\s()]+)/g)];
  const onlyRepositories = (scopeBeforeOrgs ?? '').replace(/(?:^|[\s(])repo:[^\s()]+/g, ' ').replace(/[()\s]|\bOR\b/g, '') === '';
  const inboxRepos = reposBeforeOrgs ?? (onlyRepositories ? named.flatMap(([, owner, name]) => (owner && name ? [{ owner, name }] : [])) : []);
  const savedViews = (unsplitViews ?? viewOrder?.map((id) => sync[`view:${id}`]))?.flatMap((view) => viewSchema.safeParse(view).data ?? []);
  // Views that are all earlier versions' defaults (mostly GitHub's own inbox sections, none with a Graphite filter)
  // become Graphite's defaults.
  const views = savedViews?.length && savedViews.every((view) => EARLIER_DEFAULT_IDS.includes(view.id) && !view.filter) ? DEFAULT_VIEWS : savedViews;
  // Views kept inside `settings` by an earlier version, or swapped just now, are saved as items of their own, once.
  if (views && (unsplitViews || views !== savedViews)) {
    const { views: _unsplit, ...item } = storedSettingsSchema.parse(sync.settings ?? {});
    await save(storage, sync, { ...item, viewOrder: views.map((view) => view.id) }, { prefix: 'view:', views });
  }
  return {
    ...DEFAULT_SETTINGS,
    ...preferences,
    currentOrg: null,
    ...(views && { views }),
    viewsUnassigned: (views?.length ?? 0) > 0,
    inboxRepos,
    inboxScope: scopeBeforeOrgs ?? '',
  };
}

/**
 * Saves `patch` over the current settings. `views` and `inboxRepos` belong to the organization the patch leaves current
 * (its `currentOrg`, or the one current now); its repositories are only those it owns. Choosing the first organization
 * ends the views saved before views belonged to one: the patch's `views` keep them. Rejects, saying why, when Chrome
 * refuses the write (synced storage is full).
 */
export async function setSettings(patch: Partial<Settings>, storage: SettingsStorage = browser.storage.sync): Promise<Settings> {
  // Read after getSettings, which may have rewritten what an earlier version saved.
  const current = await getSettings(storage);
  const sync = await storage.get(null);
  const { currentOrg = current.currentOrg, views, inboxRepos, viewsUnassigned: _unassigned, inboxScope: _scope, ...preferences } = patch;
  const stored = storedSettingsSchema.parse(sync.settings ?? {});
  if (!currentOrg) {
    const item: StoredSettings = { ...stored, ...preferences, currentOrg: null, ...(inboxRepos && { inboxRepos, inboxScope: repositoryScope(inboxRepos) }) };
    await save(storage, sync, views ? { ...item, viewOrder: views.map((view) => view.id) } : item, views ? { prefix: 'view:', views } : null);
    return getSettings(storage);
  }

  const { login } = currentOrg;
  const { views: _unsplit, viewOrder: _order, inboxRepos: _repos, inboxScope: _earlierScope, ...kept } = stored;
  const item: StoredSettings = {
    ...kept,
    ...preferences,
    currentOrg,
    ...(views && { viewsByOrg: { ...stored.viewsByOrg, [login]: { viewOrder: views.map((view) => view.id) } } }),
    ...(inboxRepos && { reposByOrg: { ...stored.reposByOrg, [login]: inboxRepos.filter((repo) => repo.owner.toLowerCase() === login.toLowerCase()) } }),
  };
  await save(storage, sync, item, views ? { prefix: `view:${login}/`, views } : null);
  return getSettings(storage);
}

/** Calls `onChange` with fresh settings whenever any setting changes. Returns an unsubscribe. */
export function watchSettings(onChange: (settings: Settings) => void): () => void {
  const listener = () => void getSettings().then(onChange);
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/**
 * The `settings` item as stored: the preferences, and each organization's views' order and repositories. Every field may
 * be missing (an earlier version wrote the item, or nobody has changed it); one this version cannot read counts as
 * missing (a preference as its default, a chosen organization as none), and keys it does not know stay in the item, as
 * synced storage may be written by another device's version.
 */
const storedSettingsSchema = z.looseObject({
  currentOrg: organizationSchema.nullable().optional().catch(null),
  viewsByOrg: z.record(z.string(), z.object({ viewOrder: z.array(z.string()) })).optional().catch(undefined),
  reposByOrg: z.record(z.string(), z.array(repoRefSchema)).optional().catch(undefined),
  /** Before views belonged to an organization: their order (as `view:<id>` items), or, earlier still, the views themselves. */
  viewOrder: z.array(z.string()).optional().catch(undefined),
  views: z.array(z.unknown()).optional().catch(undefined),
  inboxRepos: z.array(repoRefSchema).optional().catch(undefined),
  inboxScope: z.string().optional().catch(undefined),
  sidebarCollapsed: z.boolean().optional().catch(DEFAULT_SETTINGS.sidebarCollapsed),
  inboxGroupByStack: z.boolean().optional().catch(DEFAULT_SETTINGS.inboxGroupByStack),
  inboxEnabled: z.boolean().optional().catch(DEFAULT_SETTINGS.inboxEnabled),
  prEnabled: z.boolean().optional().catch(DEFAULT_SETTINGS.prEnabled),
  diffLayout: z.enum(['unified', 'split']).optional().catch(DEFAULT_SETTINGS.diffLayout),
  theme: z.enum(['auto', 'light', 'dark']).optional().catch(DEFAULT_SETTINGS.theme),
  mergeMethod: mergeMethodSchema.optional().catch(DEFAULT_SETTINGS.mergeMethod),
});

type StoredSettings = z.infer<typeof storedSettingsSchema>;

/**
 * Writes the `settings` item and, given, one list of views as items of their own (`<prefix><id>`) over what `sync` holds
 * now: only the views that changed, and no items for views gone from that list. Once an organization is current, the
 * items of views saved before views belonged to one (`view:<id>`) go too. A write Chrome refuses throws, saying why.
 */
async function save(storage: SettingsStorage, sync: Record<string, unknown>, item: StoredSettings, list: { prefix: string; views: View[] } | null): Promise<void> {
  const kept = new Set(list?.views.map((view) => `${list.prefix}${view.id}`));
  const listed = (key: string) => list !== null && key.startsWith(list.prefix) && !key.slice(list.prefix.length).includes('/');
  const unassigned = (key: string) => !key.slice('view:'.length).includes('/');
  const gone = Object.keys(sync).filter((key) => key.startsWith('view:') && !kept.has(key) && (listed(key) || (item.currentOrg && unassigned(key))));
  const changed = list?.views.map((view): [string, View] => [`${list.prefix}${view.id}`, view]).filter(([key, view]) => JSON.stringify(sync[key]) !== JSON.stringify(view)) ?? [];
  try {
    // Gone first, which makes room.
    if (gone.length > 0) await storage.remove(gone);
    await storage.set({ settings: item, ...Object.fromEntries(changed) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(/quota/i.test(reason) ? `Chrome's synced settings are full (${reason}): delete a section or simplify its filters.` : reason);
  }
}

/** The ids of the default views before they were Graphite's sections (most were GitHub's own inbox sections). */
const EARLIER_DEFAULT_IDS = ['needs-review', 'team-review', 'returned', 'approved', 'drafts', 'waiting-reviewers', 'recently-merged', 'waiting-author'];
