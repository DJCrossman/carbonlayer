// Everything the UI needs from the outside world, behind one interface so the same pages render
// from the background RPC in the extension and from fixtures in the dev harness (`?fixtures=1`).

import type { PrDetail, RepoRef, View, ViewResult } from '../lib/model';
import { rpc, type MergeMethod } from '../lib/rpc';
import { DEFAULT_SETTINGS, getSettings, setSettings, watchSettings, type Settings } from '../lib/settings';

export interface ReviewThreadDraft {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  body: string;
}

export interface DataSource {
  authStatus(): Promise<{ ok: boolean; login: string | null; error: string | null }>;
  fetchInbox(views: View[], force?: boolean): Promise<ViewResult[]>;
  fetchPr(repo: RepoRef, number: number, force?: boolean): Promise<PrDetail>;
  review(prId: string, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string, threads?: ReviewThreadDraft[]): Promise<void>;
  comment(prId: string, body: string): Promise<void>;
  merge(prId: string, method: MergeMethod, expectedHeadOid: string): Promise<void>;
  addThread(prId: string, path: string, line: number, side: 'LEFT' | 'RIGHT', body: string): Promise<void>;
  replyThread(threadId: string, body: string): Promise<void>;
  resolveThread(threadId: string, resolved: boolean): Promise<void>;
  markFileViewed(prId: string, path: string, viewed: boolean): Promise<void>;
  setDraft(prId: string, draft: boolean): Promise<void>;
  setAutoMerge(prId: string, enabled: boolean, method: MergeMethod): Promise<void>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  watchSettings(onChange: (settings: Settings) => void): () => void;
}

export function createRpcDataSource(): DataSource {
  return {
    authStatus: () => rpc('auth.status', undefined),
    fetchInbox: (views, force) => rpc('inbox.fetch', { views, force }),
    fetchPr: (repo, number, force) => rpc('pr.fetch', { repo, number, force }),
    review: (prId, event, body, threads) => rpc('pr.review', { prId, event, body, threads }),
    comment: (prId, body) => rpc('pr.comment', { prId, body }),
    merge: (prId, method, expectedHeadOid) => rpc('pr.merge', { prId, method, expectedHeadOid }),
    addThread: (prId, path, line, side, body) => rpc('pr.addThread', { prId, path, line, side, body }),
    replyThread: (threadId, body) => rpc('pr.replyThread', { threadId, body }),
    resolveThread: (threadId, resolved) => rpc('pr.resolveThread', { threadId, resolved }),
    markFileViewed: (prId, path, viewed) => rpc('pr.markFileViewed', { prId, path, viewed }),
    setDraft: (prId, draft) => rpc('pr.setDraft', { prId, draft }),
    setAutoMerge: (prId, enabled, method) => rpc('pr.setAutoMerge', { prId, enabled, method }),
    getSettings,
    setSettings,
    watchSettings,
  };
}

export interface Fixtures {
  inbox: ViewResult[];
  prs: PrDetail[];
  login: string;
}

/** Serves fixture data and logs mutations; settings live in memory. */
export function createFixtureDataSource(fixtures: Fixtures): DataSource {
  let settings: Settings = { ...DEFAULT_SETTINGS, token: 'fixture' };
  const listeners = new Set<(settings: Settings) => void>();
  const log = async (...args: unknown[]) => {
    console.info('[fixtures] mutation', ...args);
  };
  return {
    authStatus: async () => ({ ok: true, login: fixtures.login, error: null }),
    fetchInbox: async (views) =>
      views.map((view) => fixtures.inbox.find((r) => r.view.id === view.id) ?? { view, prs: [], totalCount: 0, fetchedAt: new Date().toISOString() }),
    fetchPr: async (repo, number) => {
      const pr = fixtures.prs.find((p) => p.repo.owner === repo.owner && p.repo.name === repo.name && p.number === number) ?? fixtures.prs[0];
      if (!pr) throw new Error(`No fixture for ${repo.owner}/${repo.name}#${number}`);
      return pr;
    },
    review: (...args) => log('review', ...args),
    comment: (...args) => log('comment', ...args),
    merge: (...args) => log('merge', ...args),
    addThread: (...args) => log('addThread', ...args),
    replyThread: (...args) => log('replyThread', ...args),
    resolveThread: (...args) => log('resolveThread', ...args),
    markFileViewed: (...args) => log('markFileViewed', ...args),
    setDraft: (...args) => log('setDraft', ...args),
    setAutoMerge: (...args) => log('setAutoMerge', ...args),
    getSettings: async () => settings,
    setSettings: async (patch) => {
      settings = { ...settings, ...patch };
      for (const listener of listeners) listener(settings);
      return settings;
    },
    watchSettings: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}
