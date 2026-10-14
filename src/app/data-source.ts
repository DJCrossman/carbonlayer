// Everything the UI needs from the outside world, behind one interface so the same pages render
// from the content script's RPC in the extension and from fixtures in the dev harness (`?fixtures=1`).

import type { ChangedFileDiff, Organization, PrDetail, PrEnrichment, PrStage, PrStages, PrSummary, RepoCandidate, RepoRef, ReviewerCandidate, StackBranches, TopRepository, View, ViewResult } from '../lib/model';
import { rpc, type InboxRowToEnrich, type MergeMethod } from '../lib/rpc';
import { getSettings, setSettings, watchSettings, type Settings, type SettingsStorage } from '../lib/settings';

export interface ReviewThreadDraft {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  /** A multi-line comment's first line, possibly on the other side; both absent for one line. */
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  body: string;
}

/** A user or team whose review request is added or withdrawn, by GitHub's numeric id. */
export interface ReviewerChange {
  id: string;
  isTeam: boolean;
}

export interface DataSource {
  fetchInbox(views: View[], force?: boolean): Promise<ViewResult[]>;
  /** Page `page` of a view's rows, whole: what "Load more" adds to a section. */
  fetchInboxPage(view: View, page: number): Promise<ViewResult>;
  /** What GitHub's dashboard leaves out of these inbox rows (mergeability, reviewers, line counts, failing checks), in the same order. */
  enrichInbox(prs: InboxRowToEnrich[]): Promise<PrEnrichment[]>;
  /** The branches of these pull requests, in the same order, by which "Group by stack" chains them; null where GitHub did not say. */
  branchesOf(prs: Array<{ repo: RepoRef; number: number }>): Promise<Array<StackBranches | null>>;
  /** The repositories GitHub's repository picker offers for what the user typed (nothing: its first list), only `owner`'s when given. */
  searchRepos(query: string, owner?: Organization | null): Promise<RepoCandidate[]>;
  /** The organizations the viewer belongs to, then their own account: whose pull requests the inbox can show. */
  listOrgs(): Promise<Organization[]>;
  /** A page of the repositories GitHub's homepage lists under "Top repositories": the first, or the one after `cursor`. */
  listTopRepositories(cursor?: number | null): Promise<{ repos: TopRepository[]; nextCursor: number | null }>;
  /** One stage of a PR's page (PrStages); `force` asks GitHub again instead of reusing what the content script has. */
  fetchPrStage<S extends PrStage>(stage: S, repo: RepoRef, number: number, force?: boolean): Promise<PrStages[S]>;
  /** The diffs of up to 20 of a PR's changed files, by path. */
  fetchPrFileDiffs(repo: RepoRef, number: number, paths: string[], force?: boolean): Promise<Record<string, ChangedFileDiff>>;
  review(prId: string, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string, threads?: ReviewThreadDraft[]): Promise<void>;
  comment(prId: string, body: string): Promise<void>;
  merge(prId: string, method: MergeMethod, expectedHeadOid: string): Promise<void>;
  addThread(prId: string, thread: ReviewThreadDraft): Promise<void>;
  replyThread(threadId: string, body: string): Promise<void>;
  resolveThread(threadId: string, resolved: boolean): Promise<void>;
  markFileViewed(prId: string, path: string, viewed: boolean): Promise<void>;
  setDraft(prId: string, draft: boolean): Promise<void>;
  /** Reverts a merged PR; resolves with GitHub's page for the revert pull request. */
  revert(prId: string): Promise<{ url: string }>;
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
    fetchInboxPage: (view, page) => rpc('inbox.fetchMore', { view, page }),
    enrichInbox: (prs) => rpc('inbox.enrich', { prs }),
    branchesOf: (prs) => rpc('inbox.branches', { prs }),
    searchRepos: (query, owner) => rpc('repos.search', { query, owner: owner && { login: owner.login, isViewer: owner.isViewer } }),
    listOrgs: () => rpc('orgs.list', {}),
    listTopRepositories: (cursor) => rpc('repos.top', { cursor }),
    fetchPrStage: (stage, repo, number, force) => prStageRequests[stage]({ repo, number, force }),
    fetchPrFileDiffs: (repo, number, paths, force) => rpc('pr.fetchFileDiffs', { repo, number, paths, force }),
    review: (prId, event, body, threads) => rpc('pr.review', { prId, event, body, threads }),
    comment: (prId, body) => rpc('pr.comment', { prId, body }),
    merge: (prId, method, expectedHeadOid) => rpc('pr.merge', { prId, method, expectedHeadOid }),
    addThread: (prId, thread) => rpc('pr.addThread', { prId, ...thread }),
    replyThread: (threadId, body) => rpc('pr.replyThread', { threadId, body }),
    resolveThread: (threadId, resolved) => rpc('pr.resolveThread', { threadId, resolved }),
    markFileViewed: (prId, path, viewed) => rpc('pr.markFileViewed', { prId, path, viewed }),
    setDraft: (prId, draft) => rpc('pr.setDraft', { prId, draft }),
    revert: (prId) => rpc('pr.revert', { prId }),
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
  inbox: Array<Omit<ViewResult, 'prs'> & { prs: InboxFixtureRow[] }>;
  /** The rows of each view's later pages, by view id, page 2 first. */
  inboxPages: Record<string, InboxFixtureRow[][]>;
  prs: PrDetail[];
}

/** An inbox row with its check list and what only its enrichment says: which checks are required, why it is blocked. */
export type InboxFixtureRow = PrSummary & Pick<PrEnrichment, 'requiredCheckNames' | 'mergeBlockedReason'>;

/** Serves fixture data as octocat, a member of acme and globex, and logs mutations; settings live in memory. */
export function createFixtureDataSource(fixtures: Fixtures): DataSource {
  // Settings as src/lib/settings.ts keeps them, in memory: at first the fixtures' own views (which may carry Graphite
  // filters the defaults do not), saved before views belonged to an organization.
  const views = fixtures.inbox.map((result) => result.view);
  const stored: Record<string, unknown> = { settings: { viewOrder: views.map((view) => view.id) }, ...Object.fromEntries(views.map((view) => [`view:${view.id}`, view])) };
  const memory: SettingsStorage = {
    get: async () => structuredClone(stored),
    set: async (items) => void Object.assign(stored, structuredClone(items)),
    remove: async (keys) => keys.forEach((key) => delete stored[key]),
  };
  const listeners = new Set<(settings: Settings) => void>();
  // The rows the organization's inbox searches: its chosen repositories', or the view's own, else all of its own.
  const searched = async (view: View) => {
    const { currentOrg, inboxRepos } = await getSettings(memory);
    const repos = view.repos?.length ? view.repos : inboxRepos;
    return (pr: PrSummary) =>
      repos.length > 0 ? repos.some((repo) => repo.owner === pr.repo.owner && repo.name === pr.repo.name) : pr.repo.owner.toLowerCase() === currentOrg?.login.toLowerCase();
  };
  const log = async (...args: unknown[]) => {
    console.info('[fixtures] mutation', ...args);
  };
  const fixturePr = (repo: RepoRef, number: number) => {
    const pr = fixtures.prs.find((p) => p.repo.owner === repo.owner && p.repo.name === repo.name && p.number === number) ?? fixtures.prs[0];
    if (!pr) throw new Error(`No fixture for ${repo.owner}/${repo.name}#${number}`);
    return pr;
  };
  return {
    // Rows as GitHub's dashboard lists them: a CI rollup without its checks, and no branches; their branches come later,
    // from branchesOf, and their merge status, reviewers and line counts from enrichInbox.
    fetchInbox: (views) =>
      Promise.all(
        views.map(async (view) => {
          const result = fixtures.inbox.find((r) => r.view.id === view.id) ?? { view, prs: [], totalCount: 0, fetchedAt: new Date().toISOString() };
          const prs = result.prs.filter(await searched(view));
          return {
            ...result,
            totalCount: prs.length === result.prs.length ? result.totalCount : prs.length,
            prs: prs.map((pr) => ({ ...pr, ci: { ...pr.ci, checks: [] }, mergeStatus: pr.isDraft ? 'DRAFT' : 'UNKNOWN', reviewers: [], additions: 0, deletions: 0, headRefName: '', baseRefName: '' })),
          };
        }),
      ),
    fetchInboxPage: async (view, page) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const first = fixtures.inbox.find((r) => r.view.id === view.id);
      const prs = (fixtures.inboxPages[view.id]?.[page - 2] ?? []).filter(await searched(view));
      return {
        view,
        totalCount: first?.totalCount ?? 0,
        fetchedAt: new Date().toISOString(),
        prs: prs.map((pr) => ({ ...pr, ci: { ...pr.ci, checks: [] }, reviewers: [], additions: 0, deletions: 0, headRefName: '', baseRefName: '' })),
      };
    },
    // The fixture rows' own values, a moment later, as GitHub's page data would give them: the checks only for a failing
    // rollup, the viewer's review as octocat's, the branches only for an open PR (its merge box).
    enrichInbox: async (prs) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const rows = [...fixtures.inbox.flatMap((result) => result.prs), ...Object.values(fixtures.inboxPages).flat(2)];
      return prs.map(({ repo, number }) => {
        const pr = rows.find((row) => row.repo.owner === repo.owner && row.repo.name === repo.name && row.number === number);
        if (!pr) return {};
        return {
          mergeStatus: pr.mergeStatus,
          reviewers: pr.reviewers,
          viewerReview: pr.reviewers.find((reviewer) => reviewer.user.login === 'octocat')?.state ?? null,
          additions: pr.additions,
          deletions: pr.deletions,
          ...(pr.ci.state === 'FAILURE' && { ci: pr.ci, requiredCheckNames: pr.requiredCheckNames ?? [] }),
          ...(pr.mergeBlockedReason && { mergeBlockedReason: pr.mergeBlockedReason }),
          ...(pr.state === 'OPEN' && { headRefName: pr.headRefName, baseRefName: pr.baseRefName }),
        };
      });
    },
    // The fixture rows' own branches, a moment later, as their page headers would name them.
    branchesOf: async (prs) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const rows = [...fixtures.inbox.flatMap((result) => result.prs), ...Object.values(fixtures.inboxPages).flat(2)];
      return prs.map(({ repo, number }) => {
        const pr = rows.find((row) => row.repo.owner === repo.owner && row.repo.name === repo.name && row.number === number);
        return pr?.baseRefName ? { baseRefName: pr.baseRefName, headRefName: pr.headRefName || null } : null;
      });
    },
    searchRepos: async (query, owner) => {
      const needle = query.trim().toLowerCase();
      return FIXTURE_REPOSITORIES.filter((repo) => `${repo.owner}/${repo.name}`.includes(needle) && (!owner || repo.owner === owner.login));
    },
    listOrgs: async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return FIXTURE_ORGANIZATIONS;
    },
    // Five on the first page, then the rest after cursor 1, as GitHub's "Show more" would.
    listTopRepositories: async (cursor) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return cursor === 1 ? { repos: FIXTURE_TOP_REPOSITORIES.slice(5), nextCursor: null } : { repos: FIXTURE_TOP_REPOSITORIES.slice(0, 5), nextCursor: 1 };
    },
    // Each stage of the fixture PR after a delay of its own, so the harness fills the page in as GitHub would. GitHub sends
    // the first file's diff with the file list; the others follow a moment later.
    fetchPrStage: async (stage, repo, number) => {
      const pr = fixturePr(repo, number);
      await new Promise((resolve) => setTimeout(resolve, FIXTURE_STAGE_DELAYS[stage]));
      const { timeline, threads, unresolvedThreadCount, files, baseOid, stack, labels, assignees, ci, requiredCheckNames, unread, ...rest } = pr;
      const { mergeStatus, reviewers, reviewDecision, viewerCanMerge, viewerCanEnableAutoMerge, allowedMergeMethods, defaultMergeMethod, autoMerge, isInMergeQueue, ...header } = rest;
      const stages: PrStages = {
        header: { ...header, viewerLogin: 'octocat', stackSource: stack.source },
        activity: { timeline },
        files: {
          baseOid,
          files: files.map(({ patch, previousPath, ...summary }) => summary),
          diffs: Object.fromEntries(files.slice(0, 1).map((file) => [file.path, { patch: file.patch, previousPath: file.previousPath }])),
        },
        threads: { threads, unresolvedThreadCount },
        mergeBox: { mergeStatus, reviewers, reviewDecision, viewerCanMerge, viewerCanEnableAutoMerge, allowedMergeMethods, defaultMergeMethod, autoMerge, isInMergeQueue },
        checks: { ci, requiredCheckNames, emptyReason: null },
        stack: { stack },
        meta: { labels, assignees },
      };
      return stages[stage];
    },
    fetchPrFileDiffs: async (repo, number, paths) => {
      const pr = fixturePr(repo, number);
      await new Promise((resolve) => setTimeout(resolve, 900));
      return Object.fromEntries(pr.files.filter((file) => paths.includes(file.path)).map((file) => [file.path, { patch: file.patch, previousPath: file.previousPath }]));
    },
    review: (...args) => log('review', ...args),
    comment: (...args) => log('comment', ...args),
    merge: (...args) => log('merge', ...args),
    addThread: (...args) => log('addThread', ...args),
    replyThread: (...args) => log('replyThread', ...args),
    resolveThread: (...args) => log('resolveThread', ...args),
    markFileViewed: (...args) => log('markFileViewed', ...args),
    setDraft: (...args) => log('setDraft', ...args),
    revert: async (...args) => {
      await log('revert', ...args);
      return { url: 'https://github.com/acme/widgets/compare/main...revert-41-parcs-client?expand=1' };
    },
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
    getSettings: () => getSettings(memory),
    setSettings: async (patch) => {
      const saved = await setSettings(patch, memory);
      for (const listener of listeners) listener(saved);
      return saved;
    },
    watchSettings: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}

/** The harness's viewer's organizations, then their own account. */
const FIXTURE_ORGANIZATIONS: Organization[] = [
  { login: 'acme', avatarUrl: '', isViewer: false },
  { login: 'globex', avatarUrl: '', isViewer: false },
  { login: 'octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4', isViewer: true },
];

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
  { owner: 'globex', name: 'billing', isPrivate: true },
  { owner: 'globex', name: 'storefront', isPrivate: true },
];

/** What the harness's homepage lists under "Top repositories"; acme has no avatar, like its organization above. */
const FIXTURE_TOP_REPOSITORIES: TopRepository[] = [
  { owner: 'acme', name: 'widgets', url: 'https://github.com/acme/widgets', avatarUrl: null },
  { owner: 'acme', name: 'platform', url: 'https://github.com/acme/platform', avatarUrl: null },
  { owner: 'octocat', name: 'hello-world', url: 'https://github.com/octocat/hello-world', avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4' },
  { owner: 'acme', name: 'api', url: 'https://github.com/acme/api', avatarUrl: null },
  { owner: 'acme', name: 'ui', url: 'https://github.com/acme/ui', avatarUrl: null },
  { owner: 'acme', name: 'infra', url: 'https://github.com/acme/infra', avatarUrl: null },
  { owner: 'octocat', name: 'spoon-knife', url: 'https://github.com/octocat/spoon-knife', avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4' },
  { owner: 'acme', name: 'docs', url: 'https://github.com/acme/docs', avatarUrl: null },
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

/** The request that loads each stage of the PR page. */
const prStageRequests: { [S in PrStage]: (args: { repo: RepoRef; number: number; force?: boolean }) => Promise<PrStages[S]> } = {
  header: (args) => rpc('pr.fetchHeader', args),
  activity: (args) => rpc('pr.fetchActivity', args),
  files: (args) => rpc('pr.fetchFiles', args),
  threads: (args) => rpc('pr.fetchThreads', args),
  mergeBox: (args) => rpc('pr.fetchMergeBox', args),
  checks: (args) => rpc('pr.fetchChecks', args),
  stack: (args) => rpc('pr.fetchStack', args),
  meta: (args) => rpc('pr.fetchMeta', args),
};

/** How long the harness takes over each stage of the PR page: the header first, as GitHub's page would come. */
const FIXTURE_STAGE_DELAYS: Record<PrStage, number> = { header: 200, stack: 450, meta: 500, activity: 600, files: 700, checks: 900, mergeBox: 1100, threads: 1300 };
