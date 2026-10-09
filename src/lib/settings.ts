// User settings, synced through browser.storage.sync. Usable from the content script, the app,
// options and popup (all have the `storage` permission). There is no token: GitHub's session is used.
// Synced storage holds at most 8 KB an item and 100 KB in all, and one view with a Graphite filter can take 2 KB, so
// each view is an item of its own (`view:<id>`) and the `settings` item holds the rest with the views' order.

import { browser } from 'wxt/browser';
import type { RepoRef, View } from './model';
import { DEFAULT_VIEWS, isView, repositoryScope } from './views';

export interface Settings {
  views: View[];
  /**
   * Prepended to every view query: the chosen `inboxRepos` as one `(repo:a OR repo:b)`, or what an earlier version let
   * the user type, e.g. "org:offstreet".
   */
  inboxScope: string;
  /** The repositories the inbox searches, as chosen in the repository picker (empty: all of them). */
  inboxRepos: RepoRef[];
  /** Whether the inbox's sections sidebar is hidden (on a wide window; a narrow one shows it on demand). */
  sidebarCollapsed: boolean;
  inboxEnabled: boolean;
  prEnabled: boolean;
  diffLayout: 'unified' | 'split';
  theme: 'auto' | 'light' | 'dark';
  mergeMethod: 'MERGE' | 'SQUASH' | 'REBASE';
}

export const DEFAULT_SETTINGS: Settings = {
  views: DEFAULT_VIEWS,
  inboxScope: '',
  inboxRepos: [],
  sidebarCollapsed: false,
  inboxEnabled: true,
  prEnabled: true,
  diffLayout: 'unified',
  theme: 'auto',
  mergeMethod: 'SQUASH',
};

export async function getSettings(): Promise<Settings> {
  const sync = await browser.storage.sync.get(null);
  const { views: unsplitViews, viewOrder, ...stored } = (sync.settings ?? {}) as Partial<Settings> & { viewOrder?: string[] };
  // Settings saved before the repository picker name the inbox's repositories only in the scope's text; a scope of
  // nothing but repositories is those repositories chosen.
  const named = [...(stored.inboxScope ?? '').matchAll(/(?:^|[\s(])repo:([^\s/()]+)\/([^\s()]+)/g)];
  const onlyRepositories = (stored.inboxScope ?? '').replace(/(?:^|[\s(])repo:[^\s()]+/g, ' ').replace(/[()\s]|\bOR\b/g, '') === '';
  const inboxRepos = stored.inboxRepos ?? (onlyRepositories ? named.map(([, owner, name]) => ({ owner: owner!, name: name! })) : []);
  const savedViews =
    unsplitViews ??
    viewOrder?.flatMap((id) => {
      const view: unknown = sync[`view:${id}`];
      return isView(view) ? [view] : [];
    });
  // Views that are all earlier versions' defaults (mostly GitHub's own inbox sections, none with a Graphite filter)
  // become Graphite's defaults.
  const views = savedViews?.length && savedViews.every((view) => EARLIER_DEFAULT_IDS.includes(view.id) && !view.filter) ? DEFAULT_VIEWS : savedViews;
  // Views kept inside `settings` by an earlier version, or swapped just now, are saved as items of their own, once.
  if (views && (unsplitViews || views !== savedViews)) await saveToSync(stored, views, sync);
  return { ...DEFAULT_SETTINGS, ...stored, ...(views && { views }), inboxRepos };
}

/** Saves `patch` over the current settings. Rejects, saying why, when Chrome refuses the write (synced storage is full). */
export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  // The inbox scope is the chosen repositories whenever they are chosen.
  const { views, ...rest } = { ...current, ...patch, ...(patch.inboxRepos && { inboxScope: repositoryScope(patch.inboxRepos) }) };
  await saveToSync(rest, views, await browser.storage.sync.get(null));
  return getSettings();
}

/** Calls `onChange` with fresh settings whenever any setting changes. Returns an unsubscribe. */
export function watchSettings(onChange: (settings: Settings) => void): () => void {
  const listener = () => void getSettings().then(onChange);
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/**
 * Writes settings in synced storage's layout (see the top of this file) over what `sync` holds now: the `settings`
 * item, the views that changed, and no items for views that are gone. A write Chrome refuses throws, saying why.
 */
async function saveToSync(settings: Omit<Partial<Settings>, 'views'>, views: View[], sync: Record<string, unknown>): Promise<void> {
  const gone = Object.keys(sync).filter((key) => key.startsWith('view:') && !views.some((view) => key === `view:${view.id}`));
  const changed = views.filter((view) => JSON.stringify(sync[`view:${view.id}`]) !== JSON.stringify(view));
  try {
    // Gone first, which makes room.
    if (gone.length > 0) await browser.storage.sync.remove(gone);
    await browser.storage.sync.set({
      settings: { ...settings, viewOrder: views.map((view) => view.id) },
      ...Object.fromEntries(changed.map((view) => [`view:${view.id}`, view])),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(/quota/i.test(reason) ? `Chrome's synced settings are full (${reason}): delete a section or simplify its filters.` : reason);
  }
}

/** The ids of the default views before they were Graphite's sections (most were GitHub's own inbox sections). */
const EARLIER_DEFAULT_IDS = ['needs-review', 'team-review', 'returned', 'approved', 'drafts', 'waiting-reviewers', 'recently-merged', 'waiting-author'];
