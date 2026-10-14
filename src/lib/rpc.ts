// RPC contract between the app (iframe on github.com, or the options page) and whoever can reach
// GitHub with the user's session. Inside github.com the app posts requests to its parent window, the
// content script answers them with same-origin fetches (cookies included); see src/lib/github-web/.

import type { ChangedFileDiff, Organization, OrgMember, PrDetail, PrEnrichment, PrStage, PrStages, PrSummary, ReactionContent, RepoCandidate, RepoRef, ReviewerCandidate, StackBranches, TopRepository, View, ViewResult } from './model';

export type MergeMethod = 'MERGE' | 'SQUASH' | 'REBASE';

/** What enriching an inbox row goes by (`inbox.enrich`). */
export type InboxRowToEnrich = Pick<PrSummary, 'repo' | 'number' | 'state' | 'isDraft' | 'author'> & { ci: Pick<PrSummary['ci'], 'state'> };

export interface RpcMethods {
  'inbox.fetch': { args: { views: View[] }; result: ViewResult[] };
  /** Page `page` of a view's rows, whole, as GitHub pages its search or section: what "Load more" adds to a section. */
  'inbox.fetchMore': { args: { view: View; page: number }; result: ViewResult };
  /**
   * What GitHub's dashboard leaves out of these inbox rows (mergeability, reviewers, line counts, failing checks), in the
   * same order. A row's state and draft flag say whether its merge box is worth asking, its CI rollup whether its checks
   * are, and its author is no reviewer.
   */
  'inbox.enrich': { args: { prs: InboxRowToEnrich[] }; result: PrEnrichment[] };
  /** The branches of these pull requests, in the same order, by which "Group by stack" chains them; null where GitHub did not say. */
  'inbox.branches': { args: { prs: Array<{ repo: RepoRef; number: number }> }; result: Array<StackBranches | null> };
  /**
   * The repositories GitHub's repository picker offers for `query` (what the user typed; empty for its first list), only
   * `owner`'s when given.
   */
  'repos.search': { args: { query: string; owner?: Pick<Organization, 'login' | 'isViewer'> | null }; result: RepoCandidate[] };
  /** A page of the repositories GitHub's homepage lists under "Top repositories": the first, or the one after `cursor`. */
  'repos.top': { args: { cursor?: number | null }; result: { repos: TopRepository[]; nextCursor: number | null } };
  /** The organizations the viewer belongs to, then their own account: whose pull requests the inbox can show. */
  'orgs.list': { args: Record<string, never>; result: Organization[] };
  /**
   * The people of an organization, as its People page lists them: whom the section editor's username fields offer. None
   * for the viewer's own account.
   */
  'orgs.people': { args: { org: Pick<Organization, 'login' | 'isViewer'> }; result: OrgMember[] };
  /** The whole PR at once, all its stages put together (the PR page itself loads them one by one, below). */
  'pr.fetch': { args: { repo: RepoRef; number: number; force?: boolean }; result: PrDetail };
  // The PR page, a stage at a time (PrStages in model.ts), each asked of GitHub every time.
  'pr.fetchHeader': { args: PrPageRequest; result: PrStages['header'] };
  'pr.fetchActivity': { args: PrPageRequest; result: PrStages['activity'] };
  'pr.fetchFiles': { args: PrPageRequest; result: PrStages['files'] };
  /** The diffs of up to 20 of the PR's changed files, by path: one of GitHub's diff_entries requests. */
  'pr.fetchFileDiffs': { args: PrPageRequest & { paths: string[] }; result: Record<string, ChangedFileDiff> };
  'pr.fetchThreads': { args: PrPageRequest; result: PrStages['threads'] };
  'pr.fetchMergeBox': { args: PrPageRequest; result: PrStages['mergeBox'] };
  'pr.fetchChecks': { args: PrPageRequest; result: PrStages['checks'] };
  'pr.fetchStack': { args: PrPageRequest; result: PrStages['stack'] };
  'pr.fetchMeta': { args: PrPageRequest; result: PrStages['meta'] };
  /** A comment's Markdown as GitHub renders it on this PR, for a comment box's Preview tab; it changes nothing. */
  'markdown.preview': { args: { text: string; prId: string }; result: { html: string } };
  'pr.review': {
    args: {
      prId: string;
      event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
      body: string;
      /** Inline comments batched into this review (Graphite's "Add to review"). */
      threads?: Array<{ path: string; line: number; side: 'LEFT' | 'RIGHT'; startLine?: number; startSide?: 'LEFT' | 'RIGHT'; body: string }>;
    };
    result: undefined;
  };
  'pr.comment': { args: { prId: string; body: string }; result: undefined };
  'pr.merge': { args: { prId: string; method: MergeMethod; expectedHeadOid: string }; result: undefined };
  'pr.addThread': {
    /** `startLine` on `startSide` to `line` on `side` for a comment on several lines. */
    args: { prId: string; path: string; line: number; side: 'LEFT' | 'RIGHT'; startLine?: number; startSide?: 'LEFT' | 'RIGHT'; body: string };
    result: undefined;
  };
  'pr.replyThread': { args: { threadId: string; body: string }; result: undefined };
  'pr.resolveThread': { args: { threadId: string; resolved: boolean }; result: undefined };
  'pr.markFileViewed': { args: { prId: string; path: string; viewed: boolean }; result: undefined };
  'pr.setDraft': { args: { prId: string; draft: boolean }; result: undefined };
  /** Reverts a merged PR as GitHub's Revert button does: a branch undoing it, and where GitHub opens its pull request. */
  'pr.revert': { args: { prId: string }; result: { url: string } };
  'pr.setAutoMerge': { args: { prId: string; enabled: boolean; method: MergeMethod }; result: undefined };
  /** Whom the viewer can ask for a review: GitHub's suggestions, then everyone else matching `query`. */
  'pr.reviewerCandidates': { args: { prId: string; query: string }; result: { suggested: ReviewerCandidate[]; reviewers: ReviewerCandidate[] } };
  /** Requests and withdraws reviews in one go, by GitHub's numeric user or team id. */
  'pr.modifyReviewers': {
    args: { prId: string; add: Array<{ id: string; isTeam: boolean }>; remove: Array<{ id: string; isTeam: boolean }> };
    result: undefined;
  };
  'pr.reRequestReview': { args: { prId: string; reviewerId: string }; result: undefined };
  /** `offered: false` when GitHub has no such re-run for the run; its page on GitHub is then the way to do it. */
  'pr.rerunFailedJobs': { args: { prId: string; runId: string }; result: { offered: boolean } };
  'pr.rerunAllJobs': { args: { prId: string; runId: string }; result: { offered: boolean } };
  /** Adds the viewer's reaction to a comment, or takes it back; `subjectId` is the comment's node id (or the PR's, for its description). */
  'pr.react': { args: { prId: string; subjectId: string; content: ReactionContent; add: boolean }; result: undefined };
}

export type RpcMethod = keyof RpcMethods;

/** The stages of the PR page each write changes. When a write succeeds, the page loads them again; every other stage stays as it is. */
export const STAGES_A_WRITE_CHANGES = {
  'pr.review': ['activity', 'mergeBox', 'threads'],
  'pr.comment': ['activity'],
  // The header and the activity both read the PR page, which the header's reload fetches anyway.
  'pr.merge': ['header', 'activity', 'mergeBox'],
  'pr.addThread': ['threads', 'activity'],
  'pr.replyThread': ['threads'],
  'pr.resolveThread': ['threads'],
  'pr.markFileViewed': ['files'],
  'pr.setDraft': ['header', 'activity', 'mergeBox'],
  // The page moves on to GitHub's page for the revert pull request; nothing shown here changes.
  'pr.revert': [],
  'pr.setAutoMerge': ['mergeBox'],
  'pr.modifyReviewers': ['mergeBox'],
  'pr.reRequestReview': ['mergeBox'],
  'pr.rerunFailedJobs': ['checks'],
  'pr.rerunAllJobs': ['checks'],
  // The page shows the reaction at once; nothing else changes.
  'pr.react': [],
} as const satisfies { [M in RpcMethod]?: readonly PrStage[] };

export interface RpcRequest<M extends RpcMethod = RpcMethod> {
  kind: 'gg-rpc';
  id: string;
  method: M;
  args: RpcMethods[M]['args'];
}

export type RpcResponse<M extends RpcMethod = RpcMethod> = { kind: 'gg-rpc-result'; id: string } & (
  | { ok: true; result: RpcMethods[M]['result'] }
  | { ok: false; error: string }
);

export function isRpcRequest(data: unknown): data is RpcRequest {
  return typeof data === 'object' && data !== null && (data as { kind?: unknown }).kind === 'gg-rpc';
}

const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let listening = false;

/**
 * Calls the content script on github.com through the parent window. Rejects when the app is not embedded, and after
 * 60 s without an answer (a stack merge stops waiting for GitHub before that; see github-web/mutations.ts).
 */
export function rpc<M extends RpcMethod>(method: M, args: RpcMethods[M]['args']): Promise<RpcMethods[M]['result']> {
  if (window.parent === window) {
    return Promise.reject(new Error('Open this page from github.com; it needs your GitHub session.'));
  }
  if (!listening) {
    listening = true;
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.origin !== 'https://github.com' || event.source !== window.parent || !isRpcResponse(event.data)) return;
      const waiter = pending.get(event.data.id);
      if (!waiter) return;
      pending.delete(event.data.id);
      if (event.data.ok) waiter.resolve(event.data.result);
      else waiter.reject(new Error(event.data.error));
    });
  }
  const id = crypto.randomUUID();
  const request: RpcRequest<M> = { kind: 'gg-rpc', id, method, args };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    window.parent.postMessage(request, 'https://github.com');
    setTimeout(() => {
      if (!pending.delete(id)) return;
      reject(new Error(`GitHub did not answer ${method} within 60 s`));
    }, 60_000);
  });
}

function isRpcResponse(data: unknown): data is RpcResponse {
  return typeof data === 'object' && data !== null && (data as { kind?: unknown }).kind === 'gg-rpc-result';
}

/** Which PR page a stage request is for. */
interface PrPageRequest {
  repo: RepoRef;
  number: number;
}
