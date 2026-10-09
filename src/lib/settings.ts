// User settings. The PAT lives in browser.storage.local only; everything else syncs.
// Usable from the background, content scripts, options and popup (all have the `storage` permission).

import { browser } from 'wxt/browser';
import type { View } from './model';
import { DEFAULT_VIEWS } from './views';

export interface Settings {
  token: string;
  views: View[];
  /** Prepended to every view query, e.g. "org:offstreet" — Graphite's repo picker equivalent. */
  inboxScope: string;
  inboxEnabled: boolean;
  prEnabled: boolean;
  diffLayout: 'unified' | 'split';
  theme: 'auto' | 'light' | 'dark';
  mergeMethod: 'MERGE' | 'SQUASH' | 'REBASE';
}

export const DEFAULT_SETTINGS: Settings = {
  token: '',
  views: DEFAULT_VIEWS,
  inboxScope: '',
  inboxEnabled: true,
  prEnabled: true,
  diffLayout: 'unified',
  theme: 'auto',
  mergeMethod: 'SQUASH',
};

export async function getSettings(): Promise<Settings> {
  const [local, sync] = await Promise.all([browser.storage.local.get('token'), browser.storage.sync.get('settings')]);
  const stored = (sync.settings ?? {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...stored, token: typeof local.token === 'string' ? local.token : '' };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const { token, ...rest } = patch;
  if (token !== undefined) await browser.storage.local.set({ token });
  if (Object.keys(rest).length > 0) {
    const current = await getSettings();
    const { token: _omit, ...syncable } = { ...current, ...rest };
    await browser.storage.sync.set({ settings: syncable });
  }
  return getSettings();
}

/** Calls `onChange` with fresh settings whenever any setting changes. Returns an unsubscribe. */
export function watchSettings(onChange: (settings: Settings) => void): () => void {
  const listener = () => void getSettings().then(onChange);
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
