// Everything the UI needs from the outside world, behind one interface so the same pages render
// from the content script's RPC in the extension and from fixtures in the dev harness (`?fixtures=1`).

import { browser } from 'wxt/browser';
import { z } from 'zod/mini';
import type { ChangedFileDiff, Emoji, Organization, OrgMember, PrDetail, PrEnrichment, PrStage, PrStages, PrSummary, ReactionContent, RepoCandidate, RepoRef, ReviewerCandidate, StackBranches, StackEntry, TopRepository, View, ViewResult } from '../lib/model';
import { rpc, type DiffEntryLine, type InboxRowToEnrich, type LineRange, type MergeCommit, type MergeMethod } from '../lib/rpc';
import { getSettings, setSettings, watchSettings, type Settings, type SettingsStorage } from '../lib/settings';
import { STACK_MERGES, stackMergesSchema, type StackMerge, type StackMergeRequest, type stackMergeMessage } from '../lib/stack-merges';
import { resolveViewQuery } from '../lib/views';

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
  /** Each view's first page of rows, in the same order; a section GitHub would not search says why (`ViewResult.error`). */
  fetchInbox(views: View[]): Promise<ViewResult[]>;
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
  /** The people of an organization, as its People page lists them; none for the viewer's own account. */
  listOrgPeople(org: Organization): Promise<OrgMember[]>;
  /** A page of the repositories GitHub's homepage lists under "Top repositories": the first, or the one after `cursor`. */
  listTopRepositories(cursor?: number | null): Promise<{ repos: TopRepository[]; nextCursor: number | null }>;
  /** One stage of a PR's page (PrStages), asked of GitHub. */
  fetchPrStage<S extends PrStage>(stage: S, repo: RepoRef, number: number): Promise<PrStages[S]>;
  /** The diffs of up to 20 of a PR's changed files, by path. */
  fetchPrFileDiffs(repo: RepoRef, number: number, paths: string[]): Promise<Record<string, ChangedFileDiff>>;
  /** A changed file's diff lines on the head commit with the lines it leaves out in `ranges` (new-file numbers) put in. */
  fetchPrDiffLines(repo: RepoRef, number: number, path: string, headOid: string, ranges: LineRange[]): Promise<DiffEntryLine[]>;
  review(prId: string, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string, threads?: ReviewThreadDraft[]): Promise<void>;
  comment(prId: string, body: string): Promise<void>;
  /** Merges with the merge commit the viewer wrote, else with the one GitHub proposes. */
  merge(prId: string, method: MergeMethod, expectedHeadOid: string, commit?: MergeCommit): Promise<void>;
  /** The merge commit GitHub's merge box proposes for merging the PR this way. */
  proposedMergeCommit(prId: string, method: MergeMethod): Promise<MergeCommit>;
  addThread(prId: string, thread: ReviewThreadDraft): Promise<void>;
  replyThread(threadId: string, body: string): Promise<void>;
  resolveThread(threadId: string, resolved: boolean): Promise<void>;
  markFileViewed(prId: string, path: string, viewed: boolean): Promise<void>;
  setDraft(prId: string, draft: boolean): Promise<void>;
  /** Reverts a merged PR; resolves with GitHub's page for the revert pull request. */
  revert(prId: string): Promise<{ url: string }>;
  setAutoMerge(prId: string, enabled: boolean, method: MergeMethod): Promise<void>;
  /** Rebases the PR's native stack onto its base branch; `complete` is false when GitHub was still at it as the answer was due. */
  rebaseStack(prId: string): Promise<{ complete: boolean }>;
  /**
   * Merges the stack up to a PR once it can, rebased first when asked, in the background (src/lib/stack-merges.ts), so it
   * carries on when this page goes; in place of any merge of the same PRs.
   */
  startStackMerge(request: StackMergeRequest): Promise<void>;
  /** Forgets a stack merge: one under way stops where it is (nothing done on GitHub is undone), one that stopped is dismissed. */
  dropStackMerge(id: string): Promise<void>;
  /** The stack merges under way, or stopped, at once and whenever they change. */
  watchStackMerges(onChange: (merges: StackMerge[]) => void): () => void;
  reviewerCandidates(prId: string, query: string): Promise<{ suggested: ReviewerCandidate[]; reviewers: ReviewerCandidate[] }>;
  modifyReviewers(prId: string, add: ReviewerChange[], remove: ReviewerChange[]): Promise<void>;
  reRequestReview(prId: string, reviewerId: string): Promise<void>;
  /** `offered: false` when GitHub has no such re-run for the workflow run. */
  rerunFailedJobs(prId: string, runId: string): Promise<{ offered: boolean }>;
  rerunAllJobs(prId: string, runId: string): Promise<{ offered: boolean }>;
  /** Adds the viewer's reaction to a comment (by its node id; the PR's own for the description), or takes it back. */
  react(prId: string, subjectId: string, content: ReactionContent, add: boolean): Promise<void>;
  /** A comment's Markdown the way GitHub renders it on the PR, in HTML: what a comment box's Preview tab shows. */
  previewMarkdown(text: string, prId: string): Promise<string>;
  /** The emoji a comment box suggests after a `:`, in GitHub's order. */
  listEmojis(): Promise<Emoji[]>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  watchSettings(onChange: (settings: Settings) => void): () => void;
}

export function createRpcDataSource(): DataSource {
  return {
    fetchInbox: (views) => rpc('inbox.fetch', { views }),
    fetchInboxPage: (view, page) => rpc('inbox.fetchMore', { view, page }),
    enrichInbox: (prs) => rpc('inbox.enrich', { prs }),
    branchesOf: (prs) => rpc('inbox.branches', { prs }),
    searchRepos: (query, owner) => rpc('repos.search', { query, owner: owner && { login: owner.login, isViewer: owner.isViewer } }),
    listOrgs: () => rpc('orgs.list', {}),
    listOrgPeople: (org) => rpc('orgs.people', { org: { login: org.login, isViewer: org.isViewer } }),
    listTopRepositories: (cursor) => rpc('repos.top', { cursor }),
    fetchPrStage: (stage, repo, number) => prStageRequests[stage]({ repo, number }),
    fetchPrFileDiffs: (repo, number, paths) => rpc('pr.fetchFileDiffs', { repo, number, paths }),
    fetchPrDiffLines: (repo, number, path, headOid, ranges) => rpc('pr.fetchDiffLines', { repo, number, path, headOid, ranges }),
    review: (prId, event, body, threads) => rpc('pr.review', { prId, event, body, threads }),
    comment: (prId, body) => rpc('pr.comment', { prId, body }),
    merge: (prId, method, expectedHeadOid, commit) => rpc('pr.merge', { prId, method, expectedHeadOid, commit }),
    proposedMergeCommit: (prId, method) => rpc('pr.proposedMergeCommit', { prId, method }),
    addThread: (prId, thread) => rpc('pr.addThread', { prId, ...thread }),
    replyThread: (threadId, body) => rpc('pr.replyThread', { threadId, body }),
    resolveThread: (threadId, resolved) => rpc('pr.resolveThread', { threadId, resolved }),
    markFileViewed: (prId, path, viewed) => rpc('pr.markFileViewed', { prId, path, viewed }),
    setDraft: (prId, draft) => rpc('pr.setDraft', { prId, draft }),
    revert: (prId) => rpc('pr.revert', { prId }),
    setAutoMerge: (prId, enabled, method) => rpc('pr.setAutoMerge', { prId, enabled, method }),
    rebaseStack: (prId) => rpc('pr.rebaseStack', { prId }),
    // The background runs them (entrypoints/background.ts), and answers whether it saved the change (null) or why not.
    startStackMerge: async (request) => {
      const message: z.infer<typeof stackMergeMessage> = { kind: 'carbonlayer-start-stack-merge', request };
      const refused = z.nullable(z.string()).parse(await browser.runtime.sendMessage(message));
      if (refused !== null) throw new Error(refused);
    },
    dropStackMerge: async (id) => {
      const message: z.infer<typeof stackMergeMessage> = { kind: 'carbonlayer-drop-stack-merge', id };
      const refused = z.nullable(z.string()).parse(await browser.runtime.sendMessage(message));
      if (refused !== null) throw new Error(refused);
    },
    // As the background saves them in storage.local, each change as it was made: a merge that merged is saved so, then
    // forgotten. What this build cannot read is left out, saying what differs.
    watchStackMerges: (onChange) => {
      let changed = false;
      const show = (stored: unknown) => {
        const merges = stackMergesSchema.safeParse(stored ?? []);
        if (merges.success) onChange(merges.data);
        else console.error('[gg]', `${STACK_MERGES} in storage.local did not match:`, z.prettifyError(merges.error));
      };
      const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
        if (area !== 'local' || !Object.hasOwn(changes, STACK_MERGES)) return;
        changed = true;
        show(changes[STACK_MERGES]?.newValue);
      };
      browser.storage.onChanged.addListener(listener);
      void browser.storage.local.get(STACK_MERGES).then((items) => changed || show(items[STACK_MERGES]));
      return () => browser.storage.onChanged.removeListener(listener);
    },
    reviewerCandidates: (prId, query) => rpc('pr.reviewerCandidates', { prId, query }),
    modifyReviewers: (prId, add, remove) => rpc('pr.modifyReviewers', { prId, add, remove }),
    reRequestReview: (prId, reviewerId) => rpc('pr.reRequestReview', { prId, reviewerId }),
    rerunFailedJobs: (prId, runId) => rpc('pr.rerunFailedJobs', { prId, runId }),
    rerunAllJobs: (prId, runId) => rpc('pr.rerunAllJobs', { prId, runId }),
    react: (prId, subjectId, content, add) => rpc('pr.react', { prId, subjectId, content, add }),
    previewMarkdown: async (text, prId) => (await rpc('markdown.preview', { text, prId })).html,
    listEmojis: () => rpc('markdown.emojis', {}),
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
  /** The whole of each fixture file whose diff leaves lines out, at its PR's head, by path. */
  fileContents: Record<string, string>;
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
  // Stack merges as the background runs one with nothing to wait for: merging, then merged a moment later, then forgotten.
  let stackMerges: StackMerge[] = [];
  const stackMergeWatchers = new Set<(merges: StackMerge[]) => void>();
  const saveStackMerges = (merges: StackMerge[]) => {
    stackMerges = merges;
    for (const watcher of stackMergeWatchers) watcher(merges);
  };
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
    // Rows the way GitHub's dashboard lists them: a CI rollup without its checks, and no branches; their branches come
    // later, from branchesOf, and their merge status, reviewers, line counts and conversations from enrichInbox. A
    // search whose parentheses do not pair up gets GitHub's answer to one: no rows, and why.
    fetchInbox: (views) =>
      Promise.all(
        views.map(async (view) => {
          const query = resolveViewQuery(view, (await getSettings(memory)).inboxScope);
          if (query.split('(').length !== query.split(')').length) {
            return { view, prs: [], totalCount: 0, fetchedAt: new Date().toISOString(), error: { message: 'The search query contains invalid syntax.', query } };
          }
          const result = fixtures.inbox.find((r) => r.view.id === view.id) ?? { view, prs: [], totalCount: 0, fetchedAt: new Date().toISOString() };
          const prs = result.prs.filter(await searched(view));
          return {
            ...result,
            totalCount: prs.length === result.prs.length ? result.totalCount : prs.length,
            prs: prs.map((pr) => ({ ...pr, ci: { ...pr.ci, checks: [] }, mergeStatus: pr.isDraft ? 'DRAFT' : 'UNKNOWN', reviewers: [], additions: 0, deletions: 0, headRefName: '', baseRefName: '', conversations: null })),
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
        prs: prs.map((pr) => ({ ...pr, ci: { ...pr.ci, checks: [] }, reviewers: [], additions: 0, deletions: 0, headRefName: '', baseRefName: '', conversations: null })),
      };
    },
    // The fixture rows' own values, and those of the fixture PRs' stack entries, a moment later, the way GitHub's page
    // data would give them: the checks and the branches only for an open PR (its status checks and merge box), the
    // viewer's review as octocat's.
    enrichInbox: async (prs) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const rows: Array<StackEntry & Pick<InboxFixtureRow, 'requiredCheckNames' | 'mergeBlockedReason'>> = [
        ...fixtures.inbox.flatMap((result) => result.prs),
        ...Object.values(fixtures.inboxPages).flat(2),
        ...fixtures.prs.flatMap((pr) => pr.stack.entries),
      ];
      return prs.map(({ repo, number }) => {
        const pr = rows.find((row) => row.repo.owner === repo.owner && row.repo.name === repo.name && row.number === number);
        if (!pr) return {};
        return {
          mergeStatus: pr.mergeStatus,
          reviewers: pr.reviewers,
          reviewDecision: pr.reviewDecision,
          viewerReview: pr.reviewers.find((reviewer) => reviewer.user.login === 'octocat')?.state ?? null,
          additions: pr.additions,
          deletions: pr.deletions,
          conversations: pr.conversations,
          ...(pr.state === 'OPEN' && { ci: pr.ci, requiredCheckNames: pr.requiredCheckNames ?? [] }),
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
    listOrgPeople: async (org) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return FIXTURE_PEOPLE[org.login] ?? [];
    },
    // Five on the first page, then the rest after cursor 1, like GitHub's "Show more".
    listTopRepositories: async (cursor) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return cursor === 1 ? { repos: FIXTURE_TOP_REPOSITORIES.slice(5), nextCursor: null } : { repos: FIXTURE_TOP_REPOSITORIES.slice(0, 5), nextCursor: 1 };
    },
    // Each stage of the fixture PR after a delay of its own, so the harness fills the page in the way GitHub does.
    // GitHub sends the first file's diff with the file list; the others follow a moment later.
    fetchPrStage: async (stage, repo, number) => {
      const pr = fixturePr(repo, number);
      await new Promise((resolve) => setTimeout(resolve, FIXTURE_STAGE_DELAYS[stage]));
      const { timeline, threads, unresolvedThreadCount, files, baseOid, stack, labels, assignees, ci, requiredCheckNames, unread, conversations, ...rest } = pr;
      const { mergeStatus, reviewers, reviewDecision, viewerCanMerge, viewerCanEnableAutoMerge, allowedMergeMethods, defaultMergeMethod, autoMerge, isInMergeQueue, stackSection, ...header } = rest;
      const stages: PrStages = {
        header: { ...header, viewerLogin: 'octocat', stackSource: stack.source },
        activity: { timeline },
        files: {
          baseOid,
          files: files.map(({ patch, previousPath, ...summary }) => summary),
          diffs: Object.fromEntries(files.slice(0, 1).map((file) => [file.path, { patch: file.patch, previousPath: file.previousPath }])),
        },
        threads: { threads, unresolvedThreadCount },
        mergeBox: { mergeStatus, reviewers, reviewDecision, viewerCanMerge, viewerCanEnableAutoMerge, allowedMergeMethods, defaultMergeMethod, autoMerge, isInMergeQueue, stackSection },
        checks: { ci, requiredCheckNames, emptyReason: null },
        // The other entries the way GitHub's stack listing names them, without a verdict, checks or mergeability: those
        // come with each entry's row details (enrichInbox).
        stack: {
          stack: {
            ...stack,
            entries: stack.entries.map((entry, index) =>
              index === stack.currentIndex
                ? entry
                : { ...entry, reviewDecision: 'NONE', reviewers: [], ci: { state: 'NONE', checks: [], counts: { success: 0, failure: 0, pending: 0, other: 0 } }, mergeStatus: entry.isDraft ? 'DRAFT' : 'UNKNOWN' },
            ),
          },
        },
        meta: { labels, assignees },
      };
      return stages[stage];
    },
    fetchPrFileDiffs: async (repo, number, paths) => {
      const pr = fixturePr(repo, number);
      await new Promise((resolve) => setTimeout(resolve, 900));
      return Object.fromEntries(pr.files.filter((file) => paths.includes(file.path)).map((file) => [file.path, { patch: file.patch, previousPath: file.previousPath }]));
    },
    // What GitHub would answer, from the fixture file's whole contents, a moment later.
    fetchPrDiffLines: async (repo, number, path, _headOid, ranges) => {
      const patch = fixturePr(repo, number).files.find((file) => file.path === path)?.patch;
      const contents = fixtures.fileContents[path];
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (!patch || contents === undefined) throw new Error(`GitHub answered 404 for /${repo.owner}/${repo.name}/pull/${number}/page_data/diff_entry_lines`);
      return fixtureDiffEntryLines(patch, contents, ranges);
    },
    review: (...args) => log('review', ...args),
    comment: (...args) => log('comment', ...args),
    merge: (...args) => log('merge', ...args),
    // What GitHub's merge box proposes, a moment later: a merge commit names the PR and its branch, its title below; a
    // squash is the title and number.
    proposedMergeCommit: async (prId, method) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const pr = fixtures.prs.find((candidate) => candidate.id === prId);
      if (!pr) throw new Error(`No fixture for ${prId}`);
      return method === 'MERGE'
        ? { commitTitle: `Merge pull request #${pr.number} from ${pr.repo.owner}/${pr.headRefName}`, commitMessage: pr.title }
        : { commitTitle: `${pr.title} (#${pr.number})`, commitMessage: '' };
    },
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
    rebaseStack: async (...args) => {
      await log('rebaseStack', ...args);
      return { complete: true };
    },
    startStackMerge: async (request) => {
      await log('startStackMerge', request);
      const merge: StackMerge = { ...request, id: crypto.randomUUID(), startedAt: Date.now(), heads: null, step: { kind: 'merging', sentAt: Date.now() }, trouble: null };
      saveStackMerges([...stackMerges.filter((other) => !other.prs.some((pr) => request.prs.some(({ number }) => number === pr.number))), merge]);
      setTimeout(() => {
        if (!stackMerges.some((other) => other.id === merge.id)) return;
        saveStackMerges(stackMerges.map((other) => (other.id === merge.id ? { ...other, step: { kind: 'merged' } } : other)));
        saveStackMerges(stackMerges.filter((other) => other.id !== merge.id));
      }, 800);
    },
    dropStackMerge: async (id) => {
      await log('dropStackMerge', id);
      saveStackMerges(stackMerges.filter((merge) => merge.id !== id));
    },
    watchStackMerges: (onChange) => {
      stackMergeWatchers.add(onChange);
      onChange(stackMerges);
      return () => stackMergeWatchers.delete(onChange);
    },
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
    react: (...args) => log('react', ...args),
    // No GitHub to render it: each paragraph as it was typed, escaped, a moment later.
    previewMarkdown: async (text) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return text
        .split(/\n\s*\n/)
        .filter((paragraph) => paragraph.trim() !== '')
        .map((paragraph) => `<p>${paragraph.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br>')}</p>`)
        .join('\n');
    },
    // Some of GitHub's emoji, in its order, a moment later.
    listEmojis: async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return FIXTURE_EMOJIS;
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

/**
 * Who is in the harness's organizations, as their People pages list them, by login: the fixture rows' people and a few
 * more, one of them without a name. The viewer's own account has none.
 */
const FIXTURE_PEOPLE: Record<string, OrgMember[]> = {
  acme: [
    { login: 'amanda-l', name: 'Amanda Liu', avatarUrl: 'https://avatars.githubusercontent.com/u/990000106?v=4' },
    { login: 'dana-r', name: 'Dana Reyes', avatarUrl: 'https://avatars.githubusercontent.com/u/990000107?v=4' },
    { login: 'jdoe', name: null, avatarUrl: 'https://avatars.githubusercontent.com/u/990000104?v=4' },
    { login: 'kenji-w', name: 'Kenji Watanabe', avatarUrl: 'https://avatars.githubusercontent.com/u/990000105?v=4' },
    { login: 'mona', name: 'Mona Lisa Octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/990000101?v=4' },
    { login: 'nat-k', name: 'Nat Kowalski', avatarUrl: 'https://avatars.githubusercontent.com/u/990000103?v=4' },
    { login: 'octocat', name: 'The Octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4' },
    { login: 'priya-s', name: 'Priya Sharma', avatarUrl: 'https://avatars.githubusercontent.com/u/990000102?v=4' },
    { login: 'sdavies', name: 'Sam Davies', avatarUrl: 'https://avatars.githubusercontent.com/u/990000108?v=4' },
  ],
  globex: [
    { login: 'hank-s', name: 'Hank Scorpio', avatarUrl: 'https://avatars.githubusercontent.com/u/990000201?v=4' },
    { login: 'lena-p', name: 'Lena Park', avatarUrl: 'https://avatars.githubusercontent.com/u/990000202?v=4' },
    { login: 'octocat', name: 'The Octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4' },
  ],
};

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
const prStageRequests: { [S in PrStage]: (args: { repo: RepoRef; number: number }) => Promise<PrStages[S]> } = {
  header: (args) => rpc('pr.fetchHeader', args),
  activity: (args) => rpc('pr.fetchActivity', args),
  files: (args) => rpc('pr.fetchFiles', args),
  threads: (args) => rpc('pr.fetchThreads', args),
  mergeBox: (args) => rpc('pr.fetchMergeBox', args),
  checks: (args) => rpc('pr.fetchChecks', args),
  stack: (args) => rpc('pr.fetchStack', args),
  meta: (args) => rpc('pr.fetchMeta', args),
};

/** How long the harness takes over each stage of the PR page: the header first, the way GitHub's page comes. */
const FIXTURE_STAGE_DELAYS: Record<PrStage, number> = { header: 200, stack: 450, meta: 500, activity: 600, files: 700, checks: 900, mergeBox: 1100, threads: 1300 };

/**
 * Some of the emoji GitHub's comment box suggests, in GitHub's order (its first ones, and each of the harness's checks'),
 * a few of them GitHub's own, with its images.
 */
const FIXTURE_EMOJIS: Emoji[] = [
  { name: '100', character: '💯' },
  { name: '1234', character: '🔢' },
  { name: '+1', character: '👍' },
  { name: '-1', character: '👎' },
  { name: '1st_place_medal', character: '🥇' },
  { name: '2nd_place_medal', character: '🥈' },
  { name: '3rd_place_medal', character: '🥉' },
  { name: '8ball', character: '🎱' },
  { name: 'atom', imageUrl: 'https://github.githubassets.com/images/icons/emoji/atom.png?v8' },
  { name: 'bowtie', imageUrl: 'https://github.githubassets.com/images/icons/emoji/bowtie.png?v8' },
  { name: 'confused', character: '😕' },
  { name: 'copilot', imageUrl: 'https://github.githubassets.com/images/icons/emoji/copilot.png?v8' },
  { name: 'eyes', character: '👀' },
  { name: 'heart', character: '❤️' },
  { name: 'laughing', character: '😆' },
  { name: 'octocat', imageUrl: 'https://github.githubassets.com/images/icons/emoji/octocat.png?v8' },
  { name: 'rocket', character: '🚀' },
  { name: 'shipit', imageUrl: 'https://github.githubassets.com/images/icons/emoji/shipit.png?v8' },
  { name: 'slightly_smiling_face', character: '🙂' },
  { name: 'smile', character: '😄' },
  { name: 'smile_cat', character: '😸' },
  { name: 'smiley', character: '😃' },
  { name: 'smiley_cat', character: '😺' },
  { name: 'smiling_face_with_three_hearts', character: '🥰' },
  { name: 'smiling_imp', character: '😈' },
  { name: 'smirk', character: '😏' },
  { name: 'sweat_smile', character: '😅' },
  { name: 'tada', character: '🎉' },
  { name: 'thinking', character: '🤔' },
  { name: 'thumbsdown', character: '👎' },
  { name: 'thumbsup', character: '👍' },
  { name: 'white_check_mark', character: '✅' },
];

/**
 * What GitHub's diff_entry_lines answers for a fixture file (docs/research/github-web-endpoints.md): every line of its
 * patch, numbered on its side or both (an added line's `left` and a removed line's `right` are 0 here), with the lines of
 * `ranges` (by their numbers in the new file) that the patch leaves out put in as CONTEXT lines, up to the end of the file
 * and no further.
 */
function fixtureDiffEntryLines(patch: string, contents: string, ranges: LineRange[]): DiffEntryLine[] {
  const fileLines = contents.replace(/\n$/, '').split('\n');
  const answer: DiffEntryLine[] = [];
  // The next line of the old file and of the new.
  let left = 1;
  let right = 1;
  for (const row of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(row);
    if (hunk) {
      // A hunk without lines on a side names the line before it there (`+12,0`).
      putAskedLinesBefore(hunk[4] === '0' ? Number(hunk[3]) + 1 : Number(hunk[3]));
      left = hunk[2] === '0' ? Number(hunk[1]) + 1 : Number(hunk[1]);
      answer.push({ type: 'HUNK', left: 0, right: 0, text: row, displayNoNewLineWarning: false });
    } else if (row.startsWith('\\')) {
      const last = answer.at(-1);
      if (last) last.displayNoNewLineWarning = true;
    } else if (row.startsWith('-')) {
      answer.push({ type: 'DELETION', left: left++, right: 0, text: row, displayNoNewLineWarning: false });
    } else if (row.startsWith('+')) {
      answer.push({ type: 'ADDITION', left: 0, right: right++, text: row, displayNoNewLineWarning: false });
    } else {
      answer.push({ type: 'CONTEXT', left: left++, right: right++, text: row, displayNoNewLineWarning: false });
    }
  }
  putAskedLinesBefore(fileLines.length + 1);
  return answer;

  /** The unchanged lines asked for from the next new line up to `before`, numbered on both sides. */
  function putAskedLinesBefore(before: number) {
    for (; right < before; left++, right++) {
      if (!ranges.some(({ start, end }) => right >= start && right <= end)) continue;
      answer.push({ type: 'CONTEXT', left, right, text: ` ${fileLines[right - 1] ?? ''}`, displayNoNewLineWarning: right === fileLines.length && !contents.endsWith('\n') });
    }
  }
}
