// RPC contract between the app (iframe on github.com, or the options page) and whoever can reach
// GitHub with the user's session. Inside github.com the app posts requests to its parent window, the
// content script answers them with same-origin fetches (cookies included); see src/lib/github-web/.

import type { PrDetail, PrEnrichment, PrSummary, RepoCandidate, RepoRef, ReviewerCandidate, View, ViewResult } from './model';

export type MergeMethod = 'MERGE' | 'SQUASH' | 'REBASE';

export interface RpcMethods {
  'inbox.fetch': { args: { views: View[]; force?: boolean }; result: ViewResult[] };
  /** Page `page` of a view's rows, whole, as GitHub pages its search or section: what "Load more" adds to a section. */
  'inbox.fetchMore': { args: { view: View; page: number }; result: ViewResult };
  /**
   * What GitHub's dashboard leaves out of these inbox rows (mergeability, reviewers, line counts), in the same order. A
   * row's state and draft flag say whether its merge box is worth asking.
   */
  'inbox.enrich': { args: { prs: Array<Pick<PrSummary, 'repo' | 'number' | 'state' | 'isDraft'>> }; result: PrEnrichment[] };
  /** The repositories GitHub's repository picker offers for `query` (what the user typed; empty for its first list). */
  'repos.search': { args: { query: string }; result: RepoCandidate[] };
  'pr.fetch': { args: { repo: RepoRef; number: number; force?: boolean }; result: PrDetail };
  'pr.review': {
    args: {
      prId: string;
      event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
      body: string;
      /** Inline comments batched into this review (Graphite's "Add to review"). */
      threads?: Array<{ path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }>;
    };
    result: undefined;
  };
  'pr.comment': { args: { prId: string; body: string }; result: undefined };
  'pr.merge': { args: { prId: string; method: MergeMethod; expectedHeadOid: string }; result: undefined };
  'pr.addThread': {
    args: { prId: string; path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string };
    result: undefined;
  };
  'pr.replyThread': { args: { threadId: string; body: string }; result: undefined };
  'pr.resolveThread': { args: { threadId: string; resolved: boolean }; result: undefined };
  'pr.markFileViewed': { args: { prId: string; path: string; viewed: boolean }; result: undefined };
  'pr.setDraft': { args: { prId: string; draft: boolean }; result: undefined };
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
}

export type RpcMethod = keyof RpcMethods;

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
