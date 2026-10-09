// Everything the UI needs from the outside world, behind one interface so the same pages render
// from the content script's RPC in the extension and from fixtures in the dev harness (`?fixtures=1`).

import type { PrDetail, RepoCandidate, RepoRef, ReviewerCandidate, View, ViewResult } from '../lib/model';
import { rpc, type MergeMethod } from '../lib/rpc';
import { DEFAULT_SETTINGS, getSettings, setSettings, watchSettings, type Settings } from '../lib/settings';
import { repositoryScope } from '../lib/views';

export interface ReviewThreadDraft {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  body: string;
}

/** A user or team whose review request is added or withdrawn, by GitHub's numeric id. */
export interface ReviewerChange {
  id: string;
  isTeam: boolean;
}

export interface DataSource {
  fetchInbox(views: View[], force?: boolean): Promise<ViewResult[]>;
  /** The repositories GitHub's repository picker offers for what the user typed (nothing: its first list). */
  searchRepos(query: string): Promise<RepoCandidate[]>;
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
  reviewerCandidates(prId: string, query: string): Promise<{ suggested: ReviewerCandidate[]; reviewers: ReviewerCandidate[] }>;
  modifyReviewers(prId: string, add: ReviewerChange[], remove: ReviewerChange[]): Promise<void>;
  reRequestReview(prId: string, reviewerId: string): Promise<void>;
  /** `offered: false` when GitHub has no such re-run for the workflow run. */
  rerunFailedJobs(prId: string, runId: string): Promise<{ offered: boolean }>;
  rerunAllJobs(prId: string, runId: string): Promise<{ offered: boolean }>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  watchSettings(onChange: (settings: Settings) => void): () => void;
}

export function createRpcDataSource(): DataSource {
  return {
    fetchInbox: (views, force) => rpc('inbox.fetch', { views, force }),
    searchRepos: (query) => rpc('repos.search', { query }),
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
    reviewerCandidates: (prId, query) => rpc('pr.reviewerCandidates', { prId, query }),
    modifyReviewers: (prId, add, remove) => rpc('pr.modifyReviewers', { prId, add, remove }),
    reRequestReview: (prId, reviewerId) => rpc('pr.reRequestReview', { prId, reviewerId }),
    rerunFailedJobs: (prId, runId) => rpc('pr.rerunFailedJobs', { prId, runId }),
    rerunAllJobs: (prId, runId) => rpc('pr.rerunAllJobs', { prId, runId }),
    getSettings,
    setSettings,
    watchSettings,
  };
}

export interface Fixtures {
  inbox: ViewResult[];
  prs: PrDetail[];
}

/** Serves fixture data and logs mutations; settings live in memory. */
export function createFixtureDataSource(fixtures: Fixtures): DataSource {
  // The fixtures' own views, which may carry Graphite filters the defaults do not.
  let settings: Settings = { ...DEFAULT_SETTINGS, views: fixtures.inbox.map((result) => result.view) };
  const listeners = new Set<(settings: Settings) => void>();
  const log = async (...args: unknown[]) => {
    console.info('[fixtures] mutation', ...args);
  };
  return {
    fetchInbox: async (views) =>
      views.map((view) => fixtures.inbox.find((r) => r.view.id === view.id) ?? { view, prs: [], totalCount: 0, fetchedAt: new Date().toISOString() }),
    searchRepos: async (query) => {
      const needle = query.trim().toLowerCase();
      return FIXTURE_REPOSITORIES.filter((repo) => `${repo.owner}/${repo.name}`.includes(needle));
    },
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
    reviewerCandidates: async (_prId, query) => {
      const needle = query.trim().toLowerCase();
      const matching = FIXTURE_REVIEWER_CANDIDATES.filter((candidate) => candidate.login.includes(needle) || !!candidate.name?.toLowerCase().includes(needle));
      return { suggested: matching.slice(0, 2), reviewers: matching.slice(2) };
    },
    modifyReviewers: (...args) => log('modifyReviewers', ...args),
    reRequestReview: (...args) => log('reRequestReview', ...args),
    rerunFailedJobs: async (...args) => {
      await log('rerunFailedJobs', ...args);
      return { offered: true };
    },
    rerunAllJobs: async (...args) => {
      await log('rerunAllJobs', ...args);
      return { offered: true };
    },
    getSettings: async () => settings,
    setSettings: async (patch) => {
      // The inbox scope is the chosen repositories whenever they are chosen, as in src/lib/settings.ts.
      settings = { ...settings, ...patch, ...(patch.inboxRepos && { inboxScope: repositoryScope(patch.inboxRepos) }) };
      for (const listener of listeners) listener(settings);
      return settings;
    },
    watchSettings: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}

/** What the harness's repository picker offers: the fixture PRs' repositories and a few more. */
const FIXTURE_REPOSITORIES: RepoCandidate[] = [
  { owner: 'acme', name: 'widgets', isPrivate: true },
  { owner: 'acme', name: 'platform', isPrivate: true },
  { owner: 'acme', name: 'api', isPrivate: true },
  { owner: 'acme', name: 'ui', isPrivate: false },
  { owner: 'acme', name: 'infra', isPrivate: true },
  { owner: 'acme', name: 'docs', isPrivate: false },
  { owner: 'octocat', name: 'hello-world', isPrivate: false },
  { owner: 'octocat', name: 'spoon-knife', isPrivate: false },
];

/** Whom the harness's reviewer picker offers: the fixture PRs' reviewers and a few more, two of them as suggestions. */
const FIXTURE_REVIEWER_CANDIDATES: ReviewerCandidate[] = [
  { id: '1002', login: 'jlord', name: 'Jessica Lord', avatarUrl: 'https://github.com/identicons/jlord.png', kind: 'user' },
  { id: '7001', login: 'acme/parcs', name: 'PARCS', avatarUrl: '', kind: 'team' },
  { id: '1001', login: 'hubot', name: 'Hubot', avatarUrl: 'https://github.com/identicons/hubot.png', kind: 'user' },
  { id: '583231', login: 'octocat', name: 'The Octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4', kind: 'user' },
  { id: '1003', login: 'nat', name: 'Nat Friedman', avatarUrl: 'https://github.com/identicons/nat.png', kind: 'user' },
  { id: '1004', login: 'priya', name: 'Priya Raman', avatarUrl: 'https://github.com/identicons/priya.png', kind: 'user' },
  { id: '7002', login: 'acme/platform-reviewers', name: 'Platform reviewers', avatarUrl: '', kind: 'team' },
];
