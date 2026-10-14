// Writes, sent as GitHub's React PR page sends them (docs/research/github-web-mutations.md; the bodies come from
// GitHub's bundle, not from captured requests). A write names its PR or thread by id, so the PRs the app has
// loaded are remembered here with what the requests need.

import type { PrDetail } from '../model';
import type { MergeMethod, RpcMethods } from '../rpc';
import { rerunWorkflowJobs } from './actions';
import type { MergeBox } from './merge-box';
import { SIGNED_OUT, getJson, send, submitForm } from './session';

export const mutations: { [M in Exclude<keyof RpcMethods, 'inbox.fetch' | 'inbox.fetchMore' | 'inbox.enrich' | 'inbox.branches' | 'repos.search' | 'repos.top' | 'orgs.list' | `pr.fetch${string}` | 'pr.reviewerCandidates' | 'markdown.preview'>]: (args: RpcMethods[M]['args']) => Promise<RpcMethods[M]['result']> } = {
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
  'pr.addThread': async ({ prId, ...comment }) => {
    const pull = pullRequestFor(prId);
    await send(`${pull.path}/page_data/create_review_comment`, 'POST', lineComment(pull, comment, true));
  },
  'pr.replyThread': async ({ threadId, body }) => {
    const thread = threadFor(threadId);
    const pull = pullRequests.get(thread.pullPath)!;
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
    await send(`${threadFor(threadId).pullPath}/page_data/${resolved ? 'resolve_thread' : 'unresolve_thread'}`, 'POST', { threadId });
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
  'pr.revert': async ({ prId }) => {
    // GitHub's own Revert button: an empty POST that makes a branch undoing the merge, then redirects to the prefilled
    // "Open a pull request" page for it, where the revert pull request is created (GitHub's PR bundle, 2026-10-14).
    let response: Response;
    try {
      response = await fetch(`${pullRequestFor(prId).path}/revert`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'GitHub-Verified-Fetch': 'true',
          'GitHub-Is-React': 'true',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Fetch-Nonce': document.querySelector('meta[name="fetch-nonce"]')?.getAttribute('content') ?? '',
          'X-GitHub-Client-Version': document.querySelector('meta[name="release"]')?.getAttribute('content') ?? '',
        },
      });
    } catch {
      throw new Error('Could not reach GitHub (network error)');
    }
    if (response.redirected && new URL(response.url).pathname === '/login') throw new Error(SIGNED_OUT);
    if (!response.ok) throw new Error(`GitHub answered ${response.status} to the revert`);
    return { url: response.url };
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
  'pr.rerunFailedJobs': ({ prId, runId }) => rerunWorkflowJobs(pullRequestFor(prId).repoPath, runId, 'failed'),
  'pr.rerunAllJobs': ({ prId, runId }) => rerunWorkflowJobs(pullRequestFor(prId).repoPath, runId, 'all'),
  'pr.react': async ({ prId, subjectId, content, add }) => {
    // GitHub's conversation page reacts with a classic form, its fields in this order, the clicked button's value last.
    const pull = pullRequestFor(prId);
    if (!pull.reactionToken) throw new Error('Reload the pull request to react');
    await submitForm(`${pull.repoPath}/reactions`, [
      ['_method', 'put'],
      ['authenticity_token', pull.reactionToken],
      ['input[subjectId]', subjectId],
      ['input[content]', `${content} ${add ? 'react' : 'unreact'}`],
    ]);
  },
};

/**
 * Remembers what later writes about a PR need, from whichever part of it has loaded: the page's id, head and stack, the
 * comparison's base, the threads (the PR page loads them in stages, pr-stages.ts), the database ids a preview names, and
 * the token GitHub's reaction forms carry.
 */
export function rememberPullRequest(
  loaded: Pick<PrDetail, 'repo' | 'number'> &
    Partial<Pick<PrDetail, 'id' | 'headOid' | 'baseOid' | 'nativeStack' | 'threads'>> & { databaseId?: number; repositoryDatabaseId?: number; reactionToken?: string },
): void {
  const path = `/${loaded.repo.owner}/${loaded.repo.name}/pull/${loaded.number}`;
  const known = pullRequests.get(path) ?? {
    path,
    repoPath: `/${loaded.repo.owner}/${loaded.repo.name}`,
    number: loaded.number,
    headOid: '',
    baseOid: '',
    isNativeStack: false,
    databaseId: '',
    repositoryDatabaseId: '',
    reactionToken: '',
  };
  if (loaded.headOid !== undefined) known.headOid = loaded.headOid;
  if (loaded.baseOid !== undefined) known.baseOid = loaded.baseOid;
  if (loaded.nativeStack !== undefined) known.isNativeStack = loaded.nativeStack !== null;
  if (loaded.databaseId !== undefined) known.databaseId = String(loaded.databaseId);
  if (loaded.repositoryDatabaseId !== undefined) known.repositoryDatabaseId = String(loaded.repositoryDatabaseId);
  if (loaded.reactionToken !== undefined) known.reactionToken = loaded.reactionToken;
  pullRequests.set(path, known);
  if (loaded.id) pullPaths.set(loaded.id, path);
  for (const thread of loaded.threads ?? []) {
    threads.set(thread.id, { pullPath: path, path: thread.path, lastCommentDatabaseId: thread.comments.at(-1)?.id ?? '' });
  }
}

/** What a request about a loaded PR needs to address it; throws when the app has not loaded it here. */
export function pullRequestFor(prId: string): KnownPullRequest {
  const pull = pullRequests.get(pullPaths.get(prId) ?? '');
  if (!pull) throw new Error('Open the pull request first');
  return pull;
}

/**
 * GitHub's request body for a comment on one line, or on a range from `startLine` to `line` (multi-line); each line is
 * on the old file (LEFT, base commit) or the new one (RIGHT, head).
 */
function lineComment(
  pull: KnownPullRequest,
  comment: { path: string; line: number; side: 'LEFT' | 'RIGHT'; startLine?: number; startSide?: 'LEFT' | 'RIGHT'; body: string },
  submitBatch: boolean,
) {
  const common = { text: comment.body, submitBatch, comparisonStartOid: pull.baseOid, comparisonEndOid: pull.headOid };
  const startSide = comment.startSide ?? comment.side;
  if (comment.startLine !== undefined && (comment.startLine !== comment.line || startSide !== comment.side)) {
    return {
      ...common,
      subjectType: 'multiline',
      path: comment.path,
      line: comment.line,
      side: comment.side.toLowerCase(),
      startLine: comment.startLine,
      startSide: startSide.toLowerCase(),
      positioning: {
        type: 'multiline',
        baseCommitOid: pull.baseOid,
        headCommitOid: pull.headOid,
        startPath: comment.path,
        startLine: comment.startLine,
        startCommitOid: startSide === 'LEFT' ? pull.baseOid : pull.headOid,
        endPath: comment.path,
        endLine: comment.line,
        endCommitOid: comment.side === 'LEFT' ? pull.baseOid : pull.headOid,
      },
    };
  }
  return {
    ...common,
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
  /** `/{owner}/{repo}`, where its workflow runs live. */
  repoPath: string;
  number: number;
  headOid: string;
  baseOid: string;
  isNativeStack: boolean;
  /** GitHub's database ids of the PR and its repository, as a preview names them; empty until the header has loaded. */
  databaseId: string;
  repositoryDatabaseId: string;
  /** The `authenticity_token` of the PR page's reaction forms, one for every subject in the repository; empty until the header has loaded. */
  reactionToken: string;
}

interface KnownThread {
  /** The PR's `/{owner}/{repo}/pull/{n}`. */
  pullPath: string;
  path: string;
  /** Replies name the comment they answer by its database id. */
  lastCommentDatabaseId: string;
}

/** By the PR's path; `pullPaths` finds that path by the PR's id. */
const pullRequests = new Map<string, KnownPullRequest>();
const pullPaths = new Map<string, string>();
const threads = new Map<string, KnownThread>();
