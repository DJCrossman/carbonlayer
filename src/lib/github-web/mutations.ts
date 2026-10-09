// Writes, sent as GitHub's React PR page sends them (docs/research/github-web-mutations.md; the bodies come from
// GitHub's bundle, not from captured requests). A write names its PR or thread by id, so the PRs the app has
// loaded are remembered here with what the requests need.

import type { PrDetail } from '../model';
import type { MergeMethod, RpcMethods } from '../rpc';
import type { MergeBox } from './merge-box';
import { getJson, send } from './session';

export const mutations: { [M in Exclude<keyof RpcMethods, 'inbox.fetch' | 'pr.fetch' | 'pr.reviewerCandidates'>]: (args: RpcMethods[M]['args']) => Promise<RpcMethods[M]['result']> } = {
  'pr.review': async ({ prId, event, body, threads }) => {
    const pull = pullRequestFor(prId);
    // Batched inline comments join the viewer's pending review; submitting the review publishes them.
    for (const thread of threads ?? []) await send(`${pull.path}/page_data/create_review_comment`, 'POST', lineComment(pull, thread, false));
    const githubEvent = event === 'APPROVE' ? 'approve' : event === 'REQUEST_CHANGES' ? 'request changes' : 'comment';
    await send(`${pull.path}/page_data/submit_review`, 'PUT', { body, event: githubEvent, headSha: pull.headOid });
  },
  'pr.comment': async ({ prId, body }) => {
    await send(`${pullRequestFor(prId).path}/page_data/create_timeline_comment`, 'POST', { text: body });
  },
  'pr.addThread': async ({ prId, path, line, side, body }) => {
    const pull = pullRequestFor(prId);
    await send(`${pull.path}/page_data/create_review_comment`, 'POST', lineComment(pull, { path, line, side, body }, true));
  },
  'pr.replyThread': async ({ threadId, body }) => {
    const thread = threadFor(threadId);
    const pull = pullRequestFor(thread.prId);
    await send(`${pull.path}/page_data/create_review_comment`, 'POST', {
      text: body,
      submitBatch: true,
      inReplyTo: Number(thread.lastCommentDatabaseId),
      path: thread.path,
      comparisonStartOid: pull.baseOid,
      comparisonEndOid: pull.headOid,
    });
  },
  'pr.resolveThread': async ({ threadId, resolved }) => {
    const pull = pullRequestFor(threadFor(threadId).prId);
    await send(`${pull.path}/page_data/${resolved ? 'resolve_thread' : 'unresolve_thread'}`, 'POST', { threadId });
  },
  'pr.merge': async ({ prId, method, expectedHeadOid }) => {
    // The app gives up on an answer after 60 s; stop waiting for a stack merge well before that.
    const giveUpAt = Date.now() + 45_000;
    const pull = pullRequestFor(prId);
    // GitHub's merge request has no head guard, so check that nobody pushed since the page was loaded.
    const header = await getJson<{ pullRequest?: { headSha?: string } }>(`${pull.path}/page_data/header`);
    const headOid = header.pullRequest?.headSha;
    if (headOid && expectedHeadOid && headOid !== expectedHeadOid) {
      throw new Error('New commits were pushed since this page loaded. Reload and review them before merging.');
    }
    const commit = await proposedMergeCommit(pull, method);
    if (!pull.isNativeStack) {
      await send(`${pull.path}/page_data/merge`, 'POST', { mergeMethod: method, ...commit, bypassBranchProtections: false });
      return;
    }
    // A GitHub-native stack merges through the stack queue, then reports progress by request id.
    const queued = await send<{ status?: string; uuid?: string }>(`${pull.path}/page_data/enqueue_stack`, 'POST', {
      mergeAction: 'DIRECT_MERGE',
      mergeMethod: method,
      ...commit,
      bypassRules: 'false',
    });
    if (queued.uuid) await stackMergeSettled(pull, queued.uuid, queued.status, giveUpAt);
  },
  'pr.setAutoMerge': async ({ prId, enabled, method }) => {
    const pull = pullRequestFor(prId);
    if (!enabled) {
      await send(`${pull.path}/page_data/disable_auto_merge`, 'POST');
      return;
    }
    await send(`${pull.path}/page_data/enable_auto_merge`, 'POST', { mergeMethod: method, ...(await proposedMergeCommit(pull, method)) });
  },
  'pr.markFileViewed': async ({ prId, path, viewed }) => {
    const pull = pullRequestFor(prId);
    if (viewed) await send(`${pull.path}/file_review`, 'POST', { path, viewed: 'viewed' });
    else await send(`${pull.path}/file_review`, 'DELETE', { path, _method: 'delete' });
  },
  'pr.setDraft': async ({ prId, draft }) => {
    await send(`${pullRequestFor(prId).path}/page_data/${draft ? 'convert_to_draft' : 'mark_ready_for_review'}`, 'POST');
  },
  'pr.modifyReviewers': async ({ prId, add, remove }) => {
    // GitHub's picker sends the whole change once, naming users and teams by numeric id.
    await send(`${pullRequestFor(prId).path}/page_data/modify_reviewers`, 'POST', {
      addReviewers: add.map(({ id, isTeam }) => ({ reviewerId: Number(id), isTeam })),
      removeReviewers: remove.map(({ id, isTeam }) => ({ reviewerId: Number(id), isTeam })),
    });
  },
  'pr.reRequestReview': async ({ prId, reviewerId }) => {
    await send(`${pullRequestFor(prId).path}/page_data/re_request_review_from_user`, 'POST', { reviewerId: Number(reviewerId) });
  },
};

/** Remembers a loaded PR (and its threads) so later writes can address it. */
export function rememberPullRequest(detail: PrDetail): void {
  pullRequests.set(detail.id, {
    path: `/${detail.repo.owner}/${detail.repo.name}/pull/${detail.number}`,
    headOid: detail.headOid,
    baseOid: detail.baseOid,
    isNativeStack: detail.stack.source === 'native',
  });
  for (const thread of detail.threads) {
    threads.set(thread.id, { prId: detail.id, path: thread.path, lastCommentDatabaseId: thread.comments.at(-1)?.id ?? '' });
  }
}

/** What a request about a loaded PR needs to address it; throws when the app has not loaded it here. */
export function pullRequestFor(prId: string): KnownPullRequest {
  const pull = pullRequests.get(prId);
  if (!pull) throw new Error('Open the pull request first');
  return pull;
}

/** GitHub's request body for a one-line comment: on the old file (LEFT, base commit) or the new one (RIGHT, head). */
function lineComment(pull: KnownPullRequest, comment: { path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }, submitBatch: boolean) {
  return {
    text: comment.body,
    submitBatch,
    comparisonStartOid: pull.baseOid,
    comparisonEndOid: pull.headOid,
    subjectType: 'line',
    path: comment.path,
    line: comment.line,
    side: comment.side.toLowerCase(),
    positioning: {
      type: 'line',
      baseCommitOid: pull.baseOid,
      headCommitOid: pull.headOid,
      path: comment.path,
      line: comment.line,
      commitOid: comment.side === 'LEFT' ? pull.baseOid : pull.headOid,
    },
  };
}

function threadFor(threadId: string): KnownThread {
  const thread = threads.get(threadId);
  if (!thread) throw new Error('Open the pull request first');
  return thread;
}

/** The merge commit title and message GitHub's merge box proposes for this method. */
async function proposedMergeCommit(pull: KnownPullRequest, method: MergeMethod): Promise<{ commitTitle: string; commitMessage: string }> {
  const box = await getJson<MergeBox>(`${pull.path}/page_data/merge_box?merge_method=${method}&bypass_requirements=false`);
  return { commitTitle: box.mergeRequirements?.commitMessageHeadline ?? '', commitMessage: box.mergeRequirements?.commitMessageBody ?? '' };
}

/**
 * Waits for a stack merge to be merged or queued, polling as GitHub's page does (1 s, backing off ×1.5), until
 * `giveUpAt`; GitHub carries on merging regardless, and the refetch that follows shows where it got to.
 */
async function stackMergeSettled(pull: KnownPullRequest, uuid: string, initialStatus: string | undefined, giveUpAt: number): Promise<void> {
  let status = initialStatus?.toLowerCase();
  let delay = 1000;
  while (status !== 'merged' && status !== 'enqueued') {
    if (Date.now() + delay > giveUpAt) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay *= 1.5;
    const progress = await getJson<{ status?: string; error?: string; message?: string }>(`${pull.path}/page_data/merge_request_status/${encodeURIComponent(uuid)}`);
    status = progress.status?.toLowerCase();
    if (status === 'failed') throw new Error(progress.error || progress.message || 'GitHub could not merge the stack');
  }
}

interface KnownPullRequest {
  /** `/{owner}/{repo}/pull/{n}` */
  path: string;
  headOid: string;
  baseOid: string;
  isNativeStack: boolean;
}

interface KnownThread {
  prId: string;
  path: string;
  /** Replies name the comment they answer by its database id. */
  lastCommentDatabaseId: string;
}

const pullRequests = new Map<string, KnownPullRequest>();
const threads = new Map<string, KnownThread>();
