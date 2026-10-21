// RPC contract between the app (iframe on github.com, or the options page) and whoever can reach
// GitHub with the user's session. Inside github.com the app posts requests to its parent window, the
// content script answers them with same-origin fetches (cookies included); see src/lib/github-web/.
// Each end reads what the other posted by the method's schemas (RPC_SCHEMAS): the content script a request's args
// (readRpcRequest), the app an answer's result (rpc). One of another shape fails, saying what differs.

import { z } from 'zod/mini';
import {
  changedFileDiffSchema,
  ciSummarySchema,
  emojiSchema,
  mentionSchema,
  mergeMethodSchema,
  organizationSchema,
  orgMemberSchema,
  prDetailSchema,
  prEnrichmentSchema,
  prStagesSchema,
  REACTION_CONTENTS,
  repoCandidateSchema,
  repoRefSchema,
  reviewerCandidateSchema,
  stackBranchesSchema,
  stackEntrySchema,
  stackReadinessSchema,
  topRepositorySchema,
  viewResultSchema,
  viewSchema,
  type PrStage,
} from './model';

export type MergeMethod = z.infer<typeof mergeMethodSchema>;

export type MergeCommit = z.infer<typeof mergeCommit>;

/** What enriching an inbox row, or a stack entry, goes by (`inbox.enrich`); a stack entry may not know its author. */
export type InboxRowToEnrich = z.infer<typeof inboxRowToEnrichSchema>;

/** A line of a changed file's diff, as GitHub's diff_entry_lines numbers and marks it (`pr.fetchDiffLines`). */
export type DiffEntryLine = RpcMethods['pr.fetchDiffLines']['result'][number];

/** Lines of a file, by their numbers in the new file, the first to the last: what `pr.fetchDiffLines` asks for. */
export type LineRange = RpcMethods['pr.fetchDiffLines']['args']['ranges'][number];

/** Each method's args and result, the way its schemas read them (RPC_SCHEMAS). */
export type RpcMethods = { [M in keyof typeof RPC_SCHEMAS]: { args: z.infer<(typeof RPC_SCHEMAS)[M]['args']>; result: z.infer<(typeof RPC_SCHEMAS)[M]['result']> } };

export type RpcMethod = keyof RpcMethods;

/** The stages of the PR page each write changes. When a write succeeds, the page loads them again; every other stage stays as it is. */
export const STAGES_A_WRITE_CHANGES = {
  'pr.review': ['activity', 'mergeBox', 'threads'],
  'pr.comment': ['activity'],
  // The header and the activity both read the PR page, which the header's reload fetches anyway. Merged as a stack, the
  // PRs below it merge too.
  'pr.merge': ['header', 'activity', 'mergeBox', 'stack'],
  'pr.addThread': ['threads', 'activity'],
  'pr.replyThread': ['threads'],
  'pr.resolveThread': ['threads'],
  'pr.markFileViewed': ['files'],
  'pr.setDraft': ['header', 'activity', 'mergeBox'],
  // The page moves on to GitHub's page for the revert pull request; nothing shown here changes.
  'pr.revert': [],
  // The merge box also says which PRs of a native stack auto-merge covers, which the stack card marks.
  'pr.setAutoMerge': ['mergeBox'],
  // Rebasing force-pushes every branch of the stack, this PR's too.
  'pr.rebaseStack': ['header', 'activity', 'mergeBox', 'checks', 'stack'],
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

/** A message the app's frame posted that is an RPC request; readRpcRequest reads its method and args. */
export const rpcRequestSchema = z.object({ kind: z.literal('gg-rpc'), id: z.string(), method: z.string(), args: z.unknown() });

/**
 * The request the app's frame posted, its args read by its method's schema. Throws, saying what differs, for a method
 * this build does not have or args of another shape; the content script answers that as the request's failure.
 */
export function readRpcRequest({ id, method, args }: z.infer<typeof rpcRequestSchema>): RpcRequest {
  if (!isRpcMethod(method)) throw new Error(`Unknown request: ${method}`);
  const read = RPC_SCHEMAS[method].args.safeParse(args);
  if (!read.success) throw new Error(`${method} was asked with args of another shape: ${z.prettifyError(read.error)}`);
  return { kind: 'gg-rpc', id, method, args: read.data };
}

/** Settles each request in flight, by id, with the answer posted for it. */
const pending = new Map<string, (answer: RpcAnswer) => void>();
let listening = false;

/**
 * Calls the content script on github.com through the parent window. Rejects when the app is not embedded, after 60 s
 * without an answer (a stack merge stops waiting for GitHub before that; see github-web/mutations.ts), and when the
 * answer is not of the method's shape, saying what differs.
 */
export function rpc<M extends RpcMethod>(method: M, args: RpcMethods[M]['args']): Promise<RpcMethods[M]['result']> {
  if (window.parent === window) {
    return Promise.reject(new Error('Open this page from github.com; it needs your GitHub session.'));
  }
  if (!listening) {
    listening = true;
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.origin !== 'https://github.com' || event.source !== window.parent) return;
      // GitHub's own page posts to this frame too.
      const answer = rpcAnswerSchema.safeParse(event.data);
      if (!answer.success) return;
      const settle = pending.get(answer.data.id);
      if (!settle) return;
      pending.delete(answer.data.id);
      settle(answer.data);
    });
  }
  const id = crypto.randomUUID();
  const request: RpcRequest<M> = { kind: 'gg-rpc', id, method, args };
  return new Promise((resolve, reject) => {
    pending.set(id, (answer) => {
      try {
        resolve(readRpcAnswer(method, answer));
      } catch (error) {
        reject(error);
      }
    });
    window.parent.postMessage(request, 'https://github.com');
    setTimeout(() => {
      if (!pending.delete(id)) return;
      reject(new Error(`GitHub did not answer ${method} within 60 s`));
    }, 60_000);
  });
}

/**
 * The result of the content script's answer to a `method` request, read by the method's schema: what `rpc` resolves
 * with, and what the background reads of an answer it asked a github.com tab for (src/lib/stack-merges.ts). Throws the
 * request's failure as the content script gave it, and, saying what differs, for an answer of another shape.
 */
export function readRpcAnswer<M extends RpcMethod>(method: M, answer: unknown): RpcMethods[M]['result'] {
  const read = rpcAnswerSchema.safeParse(answer);
  if (!read.success) throw new Error(`The answer to ${method} did not match: ${z.prettifyError(read.error)}`);
  if (!read.data.ok) throw new Error(read.data.error);
  // Each method's result schema, typed as reading that method's result, so this answer comes out as `M`'s.
  const results: { [K in RpcMethod]: { result: z.ZodMiniType<RpcMethods[K]['result']> } } = RPC_SCHEMAS;
  const result = results[method].result.safeParse(read.data.result);
  if (!result.success) throw new Error(`The answer to ${method} did not match: ${z.prettifyError(result.error)}`);
  return result.data;
}

/** Whether a method is one this build has (zod/mini's refinements check a value but do not narrow its type). */
function isRpcMethod(method: string): method is RpcMethod {
  return Object.hasOwn(RPC_SCHEMAS, method);
}

/** Which PR page a stage request is for. */
const prPageRequest = z.object({ repo: repoRefSchema, number: z.number() });

const inboxRowToEnrichSchema = z.extend(z.pick(stackEntrySchema, { repo: true, number: true, state: true, isDraft: true, author: true }), {
  ci: z.pick(ciSummarySchema, { state: true }),
});

/** A comment on the diff: `startLine` on `startSide` to `line` on `side` for one on several lines. */
const lineComment = {
  path: z.string(),
  line: z.number(),
  side: z.enum(['LEFT', 'RIGHT']),
  startLine: z.optional(z.number()),
  startSide: z.optional(z.enum(['LEFT', 'RIGHT'])),
  body: z.string(),
};

/** A reviewer requested or withdrawn, by GitHub's numeric user or team id. */
const reviewerChange = z.object({ id: z.string(), isTeam: z.boolean() });

/** A merge commit's title and message, by the names GitHub's merge requests give them. */
export const mergeCommit = z.object({ commitTitle: z.string(), commitMessage: z.string() });

/** Each method's args and result: what the content script reads a request by, and the app its answer. */
const RPC_SCHEMAS = {
  'inbox.fetch': { args: z.object({ views: z.array(viewSchema) }), result: z.array(viewResultSchema) },
  /** Page `page` of a view's rows, whole, the way GitHub pages its search or section: what "Load more" adds to a section. */
  'inbox.fetchMore': { args: z.object({ view: viewSchema, page: z.number() }), result: viewResultSchema },
  /**
   * What GitHub's dashboard leaves out of these inbox rows (mergeability, reviewers, line counts, failing checks), in the
   * same order. A row's state and draft flag say whether its merge box is worth asking, its CI rollup whether its checks
   * are, and its author, when known, is no reviewer.
   */
  'inbox.enrich': { args: z.object({ prs: z.array(inboxRowToEnrichSchema) }), result: z.array(prEnrichmentSchema) },
  /** The branches of these pull requests, in the same order, by which "Group by stack" chains them; null where GitHub did not say. */
  'inbox.branches': { args: z.object({ prs: z.array(z.object({ repo: repoRefSchema, number: z.number() })) }), result: z.array(z.nullable(stackBranchesSchema)) },
  /**
   * The repositories GitHub's repository picker offers for `query` (what the user typed; empty for its first list), only
   * `owner`'s when given.
   */
  'repos.search': {
    args: z.object({ query: z.string(), owner: z.nullish(z.pick(organizationSchema, { login: true, isViewer: true })) }),
    result: z.array(repoCandidateSchema),
  },
  /** A page of the repositories GitHub's homepage lists under "Top repositories": the first, or the one after `cursor`. */
  'repos.top': { args: z.object({ cursor: z.nullish(z.number()) }), result: z.object({ repos: z.array(topRepositorySchema), nextCursor: z.nullable(z.number()) }) },
  /** The organizations the viewer belongs to, then their own account: whose pull requests the inbox can show. */
  'orgs.list': { args: z.object({}), result: z.array(organizationSchema) },
  /**
   * The people of an organization, the way its People page lists them: whom the section editor's username fields offer.
   * None for the viewer's own account.
   */
  'orgs.people': { args: z.object({ org: z.pick(organizationSchema, { login: true, isViewer: true }) }), result: z.array(orgMemberSchema) },
  /** The whole PR at once, all its stages put together (the PR page itself loads them one by one, below). */
  'pr.fetch': { args: z.extend(prPageRequest, { force: z.optional(z.boolean()) }), result: prDetailSchema },
  // The PR page, a stage at a time (PrStages in model.ts), each asked of GitHub every time.
  'pr.fetchHeader': { args: prPageRequest, result: prStagesSchema.shape.header },
  'pr.fetchActivity': { args: prPageRequest, result: prStagesSchema.shape.activity },
  'pr.fetchFiles': { args: prPageRequest, result: prStagesSchema.shape.files },
  /** The diffs of up to 20 of the PR's changed files, by path: one of GitHub's diff_entries requests. */
  'pr.fetchFileDiffs': { args: z.extend(prPageRequest, { paths: z.array(z.string()) }), result: z.record(z.string(), changedFileDiffSchema) },
  /**
   * One changed file's diff on the head commit `headOid` with the lines it leaves out in `ranges` (by their numbers in the
   * new file) put in, as GitHub's "Expand" asks for them (page_data/diff_entry_lines): every line of the diff again, each
   * numbered in the old file (`left`) and the new (`right`), the lines asked for among them as unchanged (CONTEXT) ones.
   * Without ranges, the whole diff of a file whose lines GitHub held back, as its "Load Diff" asks for it.
   */
  'pr.fetchDiffLines': {
    args: z.extend(prPageRequest, { path: z.string(), headOid: z.string(), ranges: z.array(z.object({ start: z.number(), end: z.number() })) }),
    result: z.array(z.object({ type: z.string(), left: z.number(), right: z.number(), text: z.string(), displayNoNewLineWarning: z.boolean() })),
  },
  'pr.fetchThreads': { args: prPageRequest, result: prStagesSchema.shape.threads },
  'pr.fetchMergeBox': { args: prPageRequest, result: prStagesSchema.shape.mergeBox },
  'pr.fetchChecks': { args: prPageRequest, result: prStagesSchema.shape.checks },
  'pr.fetchStack': { args: prPageRequest, result: prStagesSchema.shape.stack },
  'pr.fetchMeta': { args: prPageRequest, result: prStagesSchema.shape.meta },
  /** A comment's Markdown the way GitHub renders it on this PR, for a comment box's Preview tab; it changes nothing. */
  'markdown.preview': { args: z.object({ text: z.string(), prId: z.string() }), result: z.object({ html: z.string() }) },
  /** The emoji a comment box suggests after a `:`, in GitHub's order: the list GitHub's own comment box loads. */
  'markdown.emojis': { args: z.object({}), result: z.array(emojiSchema) },
  /** The people and teams a comment box on the PR suggests after an `@`, in GitHub's order: the list GitHub's own comment box loads. */
  'markdown.mentions': { args: z.object({ prId: z.string() }), result: z.array(mentionSchema) },
  'pr.review': {
    args: z.object({
      prId: z.string(),
      event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
      body: z.string(),
      /** Inline comments batched into this review (Graphite's "Add to review"). */
      threads: z.optional(z.array(z.object(lineComment))),
    }),
    result: z.undefined(),
  },
  'pr.comment': { args: z.object({ prId: z.string(), body: z.string() }), result: z.undefined() },
  /** `commit` is the merge commit the viewer wrote; without it the PR merges with GitHub's proposal (`pr.proposedMergeCommit`). */
  'pr.merge': { args: z.object({ prId: z.string(), method: mergeMethodSchema, expectedHeadOid: z.string(), commit: z.optional(mergeCommit) }), result: z.undefined() },
  /** `startLine` on `startSide` to `line` on `side` for a comment on several lines. */
  'pr.addThread': { args: z.object({ prId: z.string(), ...lineComment }), result: z.undefined() },
  'pr.replyThread': { args: z.object({ threadId: z.string(), body: z.string() }), result: z.undefined() },
  'pr.resolveThread': { args: z.object({ threadId: z.string(), resolved: z.boolean() }), result: z.undefined() },
  'pr.markFileViewed': { args: z.object({ prId: z.string(), path: z.string(), viewed: z.boolean() }), result: z.undefined() },
  'pr.setDraft': { args: z.object({ prId: z.string(), draft: z.boolean() }), result: z.undefined() },
  /** Reverts a merged PR the way GitHub's Revert button does: a branch undoing it, and where GitHub opens its pull request. */
  'pr.revert': { args: z.object({ prId: z.string() }), result: z.object({ url: z.string() }) },
  'pr.setAutoMerge': { args: z.object({ prId: z.string(), enabled: z.boolean(), method: mergeMethodSchema }), result: z.undefined() },
  /**
   * Rebases the PR's native stack onto its base branch, as GitHub's "Rebase stack" does; `complete` is false when GitHub
   * was still rebasing as the answer was due (it carries on).
   */
  'pr.rebaseStack': { args: z.object({ prId: z.string() }), result: z.object({ complete: z.boolean() }) },
  /** Follows GitHub's rebase of the PR's native stack for up to 45 s more, as `pr.rebaseStack` does once it has sent it. */
  'pr.followStackRebase': { args: z.object({ prId: z.string() }), result: z.object({ complete: z.boolean() }) },
  /**
   * What merging the PR's native stack in the background waits on (src/lib/stack-merges.ts), for `prs`, the PRs it merges,
   * bottom first and this one last: the PR page's own readers of each one's state, head, checks and GitHub's verdict on
   * merging it with those below it, and of what this PR's merge box says of the stack's branches.
   */
  'pr.fetchStackReadiness': { args: z.extend(prPageRequest, { prs: z.array(z.number()) }), result: stackReadinessSchema },
  /** The merge commit GitHub's merge box proposes for merging the PR this way: what its own commit message editor starts with. */
  'pr.proposedMergeCommit': { args: z.object({ prId: z.string(), method: mergeMethodSchema }), result: mergeCommit },
  /** Whom the viewer can ask for a review: GitHub's suggestions, then everyone else matching `query`. */
  'pr.reviewerCandidates': {
    args: z.object({ prId: z.string(), query: z.string() }),
    result: z.object({ suggested: z.array(reviewerCandidateSchema), reviewers: z.array(reviewerCandidateSchema) }),
  },
  /** Requests and withdraws reviews in one go, by GitHub's numeric user or team id. */
  'pr.modifyReviewers': { args: z.object({ prId: z.string(), add: z.array(reviewerChange), remove: z.array(reviewerChange) }), result: z.undefined() },
  'pr.reRequestReview': { args: z.object({ prId: z.string(), reviewerId: z.string() }), result: z.undefined() },
  /** `offered: false` when GitHub has no such re-run for the run; its page on GitHub is then the way to do it. */
  'pr.rerunFailedJobs': { args: z.object({ prId: z.string(), runId: z.string() }), result: z.object({ offered: z.boolean() }) },
  'pr.rerunAllJobs': { args: z.object({ prId: z.string(), runId: z.string() }), result: z.object({ offered: z.boolean() }) },
  /** Adds the viewer's reaction to a comment, or takes it back; `subjectId` is the comment's node id (or the PR's, for its description). */
  'pr.react': { args: z.object({ prId: z.string(), subjectId: z.string(), content: z.enum(REACTION_CONTENTS), add: z.boolean() }), result: z.undefined() },
};

/** An answer the content script posted; `rpc` reads its result by the schema of the method it answers. */
const rpcAnswerSchema = z.discriminatedUnion('ok', [
  z.object({ kind: z.literal('gg-rpc-result'), id: z.string(), ok: z.literal(true), result: z.optional(z.unknown()) }),
  z.object({ kind: z.literal('gg-rpc-result'), id: z.string(), ok: z.literal(false), error: z.string() }),
]);

type RpcAnswer = z.infer<typeof rpcAnswerSchema>;
