// User settings, synced through browser.storage.sync. Usable from the content script, the app,
// options and popup (all have the `storage` permission). There is no token: GitHub's session is used.

import { browser } from 'wxt/browser';
import type { View } from './model';
import { DEFAULT_VIEWS } from './views';

export interface Settings {
  views: View[];
  /** Prepended to every view query, e.g. "org:offstreet" — Graphite's repo picker equivalent. */
  inboxScope: string;
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
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  await browser.storage.sync.set({ settings: { ...current, ...patch } });
  return getSettings();
}

/** Calls `onChange` with fresh settings whenever any setting changes. Returns an unsubscribe. */
export function watchSettings(onChange: (settings: Settings) => void): () => void {
  const listener = () => void getSettings().then(onChange);
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
