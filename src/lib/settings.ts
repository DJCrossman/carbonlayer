// User settings, synced through browser.storage.sync. Usable from the content script, the app,
// options and popup (all have the `storage` permission). There is no token: GitHub's session is used.

import { browser } from 'wxt/browser';
import type { RepoRef, View } from './model';
import { DEFAULT_VIEWS, repositoryScope } from './views';

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
  const sync = await browser.storage.sync.get('settings');
  const stored = (sync.settings ?? {}) as Partial<Settings>;
  // Settings saved before the repository picker name the inbox's repositories only in the scope's text; a scope of
  // nothing but repositories is those repositories chosen.
  const named = [...(stored.inboxScope ?? '').matchAll(/(?:^|[\s(])repo:([^\s/()]+)\/([^\s()]+)/g)];
  const onlyRepositories = (stored.inboxScope ?? '').replace(/(?:^|[\s(])repo:[^\s()]+/g, ' ').replace(/[()\s]|\bOR\b/g, '') === '';
  const inboxRepos = stored.inboxRepos ?? (onlyRepositories ? named.map(([, owner, name]) => ({ owner: owner!, name: name! })) : []);
  return { ...DEFAULT_SETTINGS, ...stored, inboxRepos };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  // The inbox scope is the chosen repositories whenever they are chosen.
  await browser.storage.sync.set({ settings: { ...current, ...patch, ...(patch.inboxRepos && { inboxScope: repositoryScope(patch.inboxRepos) }) } });
  return getSettings();
}

/** Calls `onChange` with fresh settings whenever any setting changes. Returns an unsubscribe. */
export function watchSettings(onChange: (settings: Settings) => void): () => void {
  const listener = () => void getSettings().then(onChange);
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
