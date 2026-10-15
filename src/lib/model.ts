// Normalised domain model shared by the content script (producer, src/lib/github-web/) and the UIs (consumers).
// Nothing here is GitHub-shaped; github-web maps GitHub's page data and page_data routes into these. Each type is its
// zod schema's, which reads what the app gets back from the content script (src/lib/rpc.ts) and from the page's cache.

import { z } from 'zod/mini';
import { graphiteFilterSchema } from './graphite';

export const repoRefSchema = z.object({ owner: z.string(), name: z.string() });

export type RepoRef = z.infer<typeof repoRefSchema>;

/** A repository the viewer can pick, the way GitHub's repository picker lists it. */
export const repoCandidateSchema = z.extend(repoRefSchema, { isPrivate: z.boolean() });

export type RepoCandidate = z.infer<typeof repoCandidateSchema>;

/** A repository GitHub's homepage lists under "Top repositories", with its owner's avatar when GitHub showed one. */
export const topRepositorySchema = z.object({ owner: z.string(), name: z.string(), url: z.string(), avatarUrl: z.nullable(z.string()) });

export type TopRepository = z.infer<typeof topRepositorySchema>;

/** An account whose pull requests an inbox shows: an organization the viewer belongs to, or the viewer's own account. */
export const organizationSchema = z.object({
  login: z.string(),
  avatarUrl: z.string(),
  /** The viewer's own account, searched as `user:` rather than `org:`. */
  isViewer: z.boolean(),
});

export type Organization = z.infer<typeof organizationSchema>;

/** Someone in an organization, the way its People page lists them. */
export const orgMemberSchema = z.object({
  login: z.string(),
  /** Their name, when they gave GitHub one. */
  name: z.nullable(z.string()),
  avatarUrl: z.string(),
});

export type OrgMember = z.infer<typeof orgMemberSchema>;

export const userRefSchema = z.object({ login: z.string(), avatarUrl: z.string(), url: z.string() });

export type UserRef = z.infer<typeof userRefSchema>;

/** GitHub's reviewDecision, with NONE when no review is required and none given. */
export const reviewDecisionSchema = z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', 'NONE']);

export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export const checkStateSchema = z.enum(['SUCCESS', 'FAILURE', 'PENDING', 'SKIPPED', 'NEUTRAL', 'CANCELLED', 'NONE']);

export type CheckState = z.infer<typeof checkStateSchema>;

export const checkRunSummarySchema = z.object({
  name: z.string(),
  state: checkStateSchema,
  url: z.nullable(z.string()),
  description: z.nullable(z.string()),
  /** Workflow / app name when known (e.g. "GitHub Actions"), used for grouping. */
  group: z.nullable(z.string()),
  startedAt: z.nullable(z.string()),
  completedAt: z.nullable(z.string()),
  /** The GitHub Actions workflow run this check is a job of; null for other apps' checks. Re-runs go by run. */
  runId: z.nullable(z.string()),
});

export type CheckRunSummary = z.infer<typeof checkRunSummarySchema>;

export const ciSummarySchema = z.object({
  state: checkStateSchema,
  checks: z.array(checkRunSummarySchema),
  counts: z.object({ success: z.number(), failure: z.number(), pending: z.number(), other: z.number() }),
});

export type CiSummary = z.infer<typeof ciSummarySchema>;

/** GitHub's mergeStateStatus plus DRAFT so the UI has one field to switch on. */
export const mergeStatusSchema = z.enum(['CLEAN', 'HAS_HOOKS', 'UNSTABLE', 'BLOCKED', 'BEHIND', 'DIRTY', 'DRAFT', 'UNKNOWN']);

export type MergeStatus = z.infer<typeof mergeStatusSchema>;

/** How a pull request merges: a merge commit, squashed or rebased. */
export const mergeMethodSchema = z.enum(['MERGE', 'SQUASH', 'REBASE']);

export const reviewerSummarySchema = z.object({
  /** A user, bot, or a team (`login` holds the team's `org/slug`). */
  kind: z.enum(['user', 'team']),
  user: userRefSchema,
  /** Latest opinionated review state from this reviewer, or PENDING when only requested. */
  state: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'PENDING', 'DISMISSED']),
  /** GitHub's numeric user or team id, which requesting and removing reviewers name; absent where GitHub does not give it (the inbox). */
  id: z.optional(z.string()),
  /** Whether the viewer may ask this reviewer to review again (a completed review GitHub offers to re-request). */
  canReRequest: z.optional(z.boolean()),
});

export type ReviewerSummary = z.infer<typeof reviewerSummarySchema>;

/** Someone the viewer can ask for a review, the way GitHub's reviewer picker lists them. */
export const reviewerCandidateSchema = z.object({
  /** GitHub's numeric user or team id. */
  id: z.string(),
  /** A user's login, or a team's `org/slug`. */
  login: z.string(),
  name: z.nullable(z.string()),
  avatarUrl: z.string(),
  kind: z.enum(['user', 'team']),
});

export type ReviewerCandidate = z.infer<typeof reviewerCandidateSchema>;

export const labelSummarySchema = z.object({ name: z.string(), color: z.string() });

export type LabelSummary = z.infer<typeof labelSummarySchema>;

/** One row in the inbox and one entry in a stack. */
export const prSummarySchema = z.object({
  id: z.string(),
  repo: repoRefSchema,
  number: z.number(),
  title: z.string(),
  url: z.string(),
  author: userRefSchema,
  state: z.enum(['OPEN', 'MERGED', 'CLOSED']),
  isDraft: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  mergedAt: z.nullable(z.string()),
  headRefName: z.string(),
  baseRefName: z.string(),
  reviewDecision: reviewDecisionSchema,
  reviewers: z.array(reviewerSummarySchema),
  ci: ciSummarySchema,
  mergeStatus: mergeStatusSchema,
  additions: z.number(),
  deletions: z.number(),
  changedFiles: z.number(),
  labels: z.array(labelSummarySchema),
  /** Comment + review-comment count, for the inbox row. */
  commentCount: z.number(),
  /** GitHub's isReadByViewer, inverted; null when GitHub does not report it. */
  unread: z.nullable(z.boolean()),
  isInMergeQueue: z.boolean(),
  autoMerge: z.nullable(z.object({ method: mergeMethodSchema })),
  /** GitHub-native stacked PR position (1 = closest to trunk); null for Graphite stacks and plain PRs. */
  nativeStack: z.nullable(z.object({ position: z.number(), size: z.number() })),
  /** Its review conversations (threads), how many resolved of how many, the way Graphite counts them; null while unknown. */
  conversations: z.nullable(z.object({ resolved: z.number(), total: z.number() })),
});

export type PrSummary = z.infer<typeof prSummarySchema>;

/**
 * What the inbox learns about a row after GitHub's dashboard listed it, from the PR's own page data: its mergeability,
 * reviewers and the review verdict they make, line counts and conversations, the viewer's own review, for failing checks
 * which checks fail and which are required, and for an open PR its branches, by which the inbox finds its stack. The PR
 * page's stack card shows the same for each other entry. A field is absent where GitHub did not say.
 */
export const prEnrichmentSchema = z.extend(
  z.partial(
    z.pick(prSummarySchema, { mergeStatus: true, reviewers: true, reviewDecision: true, additions: true, deletions: true, ci: true, headRefName: true, baseRefName: true, conversations: true }),
  ),
  {
    /** The signed-in viewer's own state among the reviewers; null when they are not one. */
    viewerReview: z.optional(z.nullable(reviewerSummarySchema.shape.state)),
    /** The names of the required checks, once GitHub has listed the checks and said which are required. */
    requiredCheckNames: z.optional(z.array(z.string())),
    /** Why the merge box says the PR cannot merge, in its words. */
    mergeBlockedReason: z.optional(z.string()),
  },
);

export type PrEnrichment = z.infer<typeof prEnrichmentSchema>;

/**
 * A PR's branches the way its page header names them, by which "Group by stack" chains the inbox's rows before they are
 * enriched. `headRefName` is null for a PR from a fork: its head branch says nothing about this repository's stacks.
 */
export const stackBranchesSchema = z.object({ baseRefName: z.string(), headRefName: z.nullable(z.string()) });

export type StackBranches = z.infer<typeof stackBranchesSchema>;

/**
 * One PR in a stack. Its author is null where GitHub did not say who opened it: an entry the stack's own listing names
 * (which names nobody) whose page header GitHub did not answer.
 */
export const stackEntrySchema = z.extend(prSummarySchema, {
  author: z.nullable(userRefSchema),
  /**
   * Whether GitHub can merge it now with the open PRs below it, as one stack: its own `stack_mergeability` says READY.
   * GitHub is asked for each open PR of a GitHub-native stack from the bottom up to the viewed one; false for the others
   * of such a stack, absent outside one.
   */
  readyToMergeAsStack: z.optional(z.boolean()),
});

export type StackEntry = z.infer<typeof stackEntrySchema>;

export const stackSchema = z.object({
  /** Ordered from the PR closest to trunk (index 0) to the top of the stack. */
  entries: z.array(stackEntrySchema),
  /** Index of the PR being viewed in `entries`. */
  currentIndex: z.number(),
  trunk: z.string(),
  /** Where the ordering came from; 'none' means a single, unstacked PR. */
  source: z.enum(['native', 'graphite-comment', 'none']),
});

export type Stack = z.infer<typeof stackSchema>;

/** GitHub's eight reactions, in the order its reaction picker offers them. */
export const REACTION_CONTENTS = ['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'HOORAY', 'CONFUSED', 'HEART', 'ROCKET', 'EYES'] as const;

export type ReactionContent = (typeof REACTION_CONTENTS)[number];

/** One of the reactions a comment has: how many gave it, and whether the viewer is one of them. */
export const reactionSchema = z.object({ content: z.enum(REACTION_CONTENTS), count: z.number(), viewerHasReacted: z.boolean() });

export type Reaction = z.infer<typeof reactionSchema>;

/** What a comment the viewer can react to has. */
const reactable = {
  /** GitHub's node id for it (`IC_…`, `PRR_…`, `PRRC_…`), which a reaction names; null where GitHub's page offers no way to react. */
  subjectId: z.nullable(z.string()),
  /** Only the reactions someone gave, in GitHub's order. */
  reactions: z.array(reactionSchema),
};

export const reviewThreadSchema = z.object({
  id: z.string(),
  path: z.string(),
  /** Line in the new file (RIGHT) or old file (LEFT); null when outdated beyond the current diff. */
  line: z.nullable(z.number()),
  startLine: z.nullable(z.number()),
  side: z.enum(['LEFT', 'RIGHT']),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  diffHunk: z.string(),
  comments: z.array(z.object({ id: z.string(), author: userRefSchema, bodyHtml: z.string(), createdAt: z.string(), url: z.string(), ...reactable })),
});

export type ReviewThread = z.infer<typeof reviewThreadSchema>;

export const timelineItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('comment'), id: z.string(), author: userRefSchema, bodyHtml: z.string(), createdAt: z.string(), url: z.string(), ...reactable }),
  z.object({
    kind: z.literal('review'),
    id: z.string(),
    author: userRefSchema,
    state: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING']),
    bodyHtml: z.string(),
    createdAt: z.string(),
    url: z.string(),
    /** Thread ids opened by this review, so the UI can link review → threads. */
    threadIds: z.array(z.string()),
    ...reactable,
  }),
  z.object({
    kind: z.literal('commit'),
    id: z.string(),
    oid: z.string(),
    abbreviatedOid: z.string(),
    messageHeadline: z.string(),
    author: z.nullable(userRefSchema),
    committedAt: z.string(),
    url: z.string(),
  }),
  z.object({ kind: z.literal('force-push'), id: z.string(), actor: z.nullable(userRefSchema), createdAt: z.string(), beforeOid: z.string(), afterOid: z.string() }),
  z.object({ kind: z.literal('review-requested'), id: z.string(), actor: z.nullable(userRefSchema), requested: z.string(), createdAt: z.string() }),
  z.object({ kind: z.enum(['ready-for-review', 'converted-to-draft', 'merged', 'closed', 'reopened']), id: z.string(), actor: z.nullable(userRefSchema), createdAt: z.string() }),
]);

export type TimelineItem = z.infer<typeof timelineItemSchema>;

export const changedFileSchema = z.object({
  path: z.string(),
  previousPath: z.nullable(z.string()),
  status: z.enum(['added', 'removed', 'modified', 'renamed', 'copied', 'changed']),
  additions: z.number(),
  deletions: z.number(),
  /** Unified diff hunks for this file, rebuilt from GitHub's diff lines; null for binary / too large. */
  patch: z.nullable(z.string()),
  viewerViewedState: z.enum(['VIEWED', 'UNVIEWED', 'DISMISSED']),
  blobUrl: z.string(),
});

export type ChangedFile = z.infer<typeof changedFileSchema>;

export const prDetailSchema = z.extend(prSummarySchema, {
  bodyHtml: z.string(),
  /** The description's reactions; a reaction names the description by the PR's own id. */
  descriptionReactions: z.array(reactionSchema),
  /** GitHub's permalink to the description (`…/pull/<n>#issue-<id>`); null when the conversation names none. */
  descriptionUrl: z.nullable(z.string()),
  headOid: z.string(),
  baseOid: z.string(),
  assignees: z.array(userRefSchema),
  viewerCanUpdate: z.boolean(),
  viewerDidAuthor: z.boolean(),
  timeline: z.array(timelineItemSchema),
  threads: z.array(reviewThreadSchema),
  files: z.array(changedFileSchema),
  stack: stackSchema,
  defaultMergeMethod: mergeMethodSchema,
  allowedMergeMethods: z.array(mergeMethodSchema),
  viewerCanMerge: z.boolean(),
  viewerCanEnableAutoMerge: z.boolean(),
  /** Required checks only, derived from `isRequired`; empty when the repo has no required checks. */
  requiredCheckNames: z.array(z.string()),
  unresolvedThreadCount: z.number(),
});

export type PrDetail = z.infer<typeof prDetailSchema>;

/** A changed file the way GitHub lists it, before its diff arrives. */
export const changedFileSummarySchema = z.omit(changedFileSchema, { patch: true, previousPath: true });

export type ChangedFileSummary = z.infer<typeof changedFileSummarySchema>;

/** What a changed file's diff adds to its summary: the patch, and the path it had before a rename or copy. */
export const changedFileDiffSchema = z.pick(changedFileSchema, { patch: true, previousPath: true });

export type ChangedFileDiff = z.infer<typeof changedFileDiffSchema>;

/**
 * The PR page, stage by stage: each is loaded on its own (`pr.fetch<Stage>`, src/lib/github-web/pr-stages.ts) and
 * rendered as soon as it arrives. Together they make a PrDetail.
 */
export const prStagesSchema = z.object({
  /** The PR page's HTML with its file and line counts: everything the header and the description need. */
  header: z.extend(
    z.pick(prDetailSchema, {
      id: true,
      repo: true,
      number: true,
      title: true,
      url: true,
      author: true,
      state: true,
      isDraft: true,
      createdAt: true,
      updatedAt: true,
      mergedAt: true,
      headRefName: true,
      baseRefName: true,
      additions: true,
      deletions: true,
      changedFiles: true,
      commentCount: true,
      nativeStack: true,
      bodyHtml: true,
      descriptionReactions: true,
      descriptionUrl: true,
      headOid: true,
      viewerCanUpdate: true,
      viewerDidAuthor: true,
    }),
    {
      viewerLogin: z.string(),
      /** Where the page shows a stack coming from (GitHub's own, or Graphite's comment); the `stack` stage has the final word. */
      stackSource: stackSchema.shape.source,
    },
  ),
  activity: z.pick(prDetailSchema, { timeline: true }),
  /** Every changed file, and the diffs GitHub sent along with the list; the others come a batch at a time (`pr.fetchFileDiffs`). */
  files: z.object({ baseOid: z.string(), files: z.array(changedFileSummarySchema), diffs: z.record(z.string(), changedFileDiffSchema) }),
  threads: z.pick(prDetailSchema, { threads: true, unresolvedThreadCount: true }),
  mergeBox: z.pick(prDetailSchema, {
    mergeStatus: true,
    reviewers: true,
    reviewDecision: true,
    viewerCanMerge: true,
    viewerCanEnableAutoMerge: true,
    allowedMergeMethods: true,
    defaultMergeMethod: true,
    autoMerge: true,
    isInMergeQueue: true,
  }),
  checks: z.extend(z.pick(prDetailSchema, { ci: true, requiredCheckNames: true }), {
    /** Why the checks list is empty when it is (GitHub answered 404, or sent no rows): the card shows it, so an empty card is never a mystery. */
    emptyReason: z.nullable(z.string()),
  }),
  stack: z.pick(prDetailSchema, { stack: true }),
  meta: z.pick(prDetailSchema, { labels: true, assignees: true }),
});

export type PrStages = z.infer<typeof prStagesSchema>;

export type PrStage = keyof PrStages;

export const viewSchema = z.object({
  id: z.string(),
  name: z.string(),
  /**
   * GitHub search query, e.g. "is:open is:pr review-requested:@me". `@me` is allowed. With a `filter`, compiled from it
   * and `repos` whenever the view is saved.
   */
  query: z.string(),
  /**
   * Graphite's form of the section's filter, edited row by row; absent for a hand-written query. Read when used: graphite.ts
   * reaches this module (through views.ts) before it has defined the filter's schema.
   */
  filter: z.optional(z.lazy(() => graphiteFilterSchema)),
  /** The repositories the view searches instead of the inbox's (absent or empty: the inbox's). */
  repos: z.optional(z.array(repoRefSchema)),
  limit: z.optional(z.number()),
  collapsed: z.optional(z.boolean()),
});

export type View = z.infer<typeof viewSchema>;

export const viewResultSchema = z.object({
  view: viewSchema,
  prs: z.array(prSummarySchema),
  totalCount: z.number(),
  fetchedAt: z.string(),
  /**
   * Why the section has no rows: GitHub would not run its search (in GitHub's words, such as "The search query contains
   * invalid syntax.") or the request failed. `query` is what GitHub was asked: the search, scope and all, or
   * `inbox:<filter>` for one of GitHub's own sections.
   */
  error: z.optional(z.object({ message: z.string(), query: z.string() })),
});

export type ViewResult = z.infer<typeof viewResultSchema>;

/**
 * An emoji a comment box suggests after a `:`, as GitHub's list has it: one of Unicode's, typed as its character, or one
 * of GitHub's own (`shipit`, `octocat`), typed as `:name:` and shown as its image.
 */
export const emojiSchema = z.union([z.object({ name: z.string(), character: z.string() }), z.object({ name: z.string(), imageUrl: z.string() })]);

export type Emoji = z.infer<typeof emojiSchema>;
