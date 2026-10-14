// Normalised domain model shared by the content script (producer, src/lib/github-web/) and the UIs (consumers).
// Nothing here is GitHub-shaped; github-web maps GitHub's page data and page_data routes into these.

import type { GraphiteFilter } from './graphite';

export interface RepoRef {
  owner: string;
  name: string;
}

/** A repository the viewer can pick, as GitHub's repository picker lists it. */
export interface RepoCandidate extends RepoRef {
  isPrivate: boolean;
}

/** A repository GitHub's homepage lists under "Top repositories", with its owner's avatar when GitHub showed one. */
export interface TopRepository {
  owner: string;
  name: string;
  url: string;
  avatarUrl: string | null;
}

/** An account whose pull requests an inbox shows: an organization the viewer belongs to, or the viewer's own account. */
export interface Organization {
  login: string;
  avatarUrl: string;
  /** The viewer's own account, searched as `user:` rather than `org:`. */
  isViewer: boolean;
}

/** Someone in an organization, as its People page lists them. */
export interface OrgMember {
  login: string;
  /** Their name, when they gave GitHub one. */
  name: string | null;
  avatarUrl: string;
}

export interface UserRef {
  login: string;
  avatarUrl: string;
  url: string;
}

type PrState = 'OPEN' | 'MERGED' | 'CLOSED';

/** GitHub's reviewDecision, with NONE when no review is required and none given. */
export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | 'NONE';

export type CheckState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'SKIPPED' | 'NEUTRAL' | 'CANCELLED' | 'NONE';

export interface CheckRunSummary {
  name: string;
  state: CheckState;
  url: string | null;
  description: string | null;
  /** Workflow / app name when known (e.g. "GitHub Actions"), used for grouping. */
  group: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** The GitHub Actions workflow run this check is a job of; null for other apps' checks. Re-runs go by run. */
  runId: string | null;
}

export interface CiSummary {
  state: CheckState;
  checks: CheckRunSummary[];
  counts: { success: number; failure: number; pending: number; other: number };
}

/** GitHub's mergeStateStatus plus DRAFT so the UI has one field to switch on. */
export type MergeStatus =
  | 'CLEAN'
  | 'HAS_HOOKS'
  | 'UNSTABLE'
  | 'BLOCKED'
  | 'BEHIND'
  | 'DIRTY'
  | 'DRAFT'
  | 'UNKNOWN';

export interface ReviewerSummary {
  /** A user, bot, or a team (`login` holds the team's `org/slug`). */
  kind: 'user' | 'team';
  user: UserRef;
  /** Latest opinionated review state from this reviewer, or PENDING when only requested. */
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED';
  /** GitHub's numeric user or team id, which requesting and removing reviewers name; absent where GitHub does not give it (the inbox). */
  id?: string;
  /** Whether the viewer may ask this reviewer to review again (a completed review GitHub offers to re-request). */
  canReRequest?: boolean;
}

/** Someone the viewer can ask for a review, as GitHub's reviewer picker lists them. */
export interface ReviewerCandidate {
  /** GitHub's numeric user or team id. */
  id: string;
  /** A user's login, or a team's `org/slug`. */
  login: string;
  name: string | null;
  avatarUrl: string;
  kind: 'user' | 'team';
}

export interface LabelSummary {
  name: string;
  color: string;
}

/** One row in the inbox and one entry in a stack. */
export interface PrSummary {
  id: string;
  repo: RepoRef;
  number: number;
  title: string;
  url: string;
  author: UserRef;
  state: PrState;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  headRefName: string;
  baseRefName: string;
  reviewDecision: ReviewDecision;
  reviewers: ReviewerSummary[];
  ci: CiSummary;
  mergeStatus: MergeStatus;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: LabelSummary[];
  /** Comment + review-comment count, for the inbox row. */
  commentCount: number;
  /** GitHub's isReadByViewer, inverted; null when GitHub does not report it. */
  unread: boolean | null;
  isInMergeQueue: boolean;
  autoMerge: { method: 'MERGE' | 'SQUASH' | 'REBASE' } | null;
  /** GitHub-native stacked PR position (1 = closest to trunk); null for Graphite stacks and plain PRs. */
  nativeStack: { position: number; size: number } | null;
  /** Its review conversations (threads), how many resolved of how many, as Graphite counts them; null while unknown. */
  conversations: { resolved: number; total: number } | null;
}

/**
 * What the inbox learns about a row after GitHub's dashboard listed it, from the PR's own page data: its mergeability,
 * reviewers, line counts and conversations, the viewer's own review, for failing checks which checks fail and which
 * are required, and for an open PR its branches, by which the inbox finds its stack. A field is absent where GitHub did
 * not say.
 */
export type PrEnrichment = Partial<Pick<PrSummary, 'mergeStatus' | 'reviewers' | 'additions' | 'deletions' | 'ci' | 'headRefName' | 'baseRefName' | 'conversations'>> & {
  /** The signed-in viewer's own state among the reviewers; null when they are not one. */
  viewerReview?: ReviewerSummary['state'] | null;
  /** The names of the required checks, once GitHub has listed the checks and said which are required. */
  requiredCheckNames?: string[];
  /** Why the merge box says the PR cannot merge, in its words. */
  mergeBlockedReason?: string;
};

/**
 * A PR's branches as its page header names them, by which "Group by stack" chains the inbox's rows before they are
 * enriched. `headRefName` is null for a PR from a fork: its head branch says nothing about this repository's stacks.
 */
export interface StackBranches {
  baseRefName: string;
  headRefName: string | null;
}

export interface Stack {
  /** Ordered from the PR closest to trunk (index 0) to the top of the stack. */
  entries: PrSummary[];
  /** Index of the PR being viewed in `entries`. */
  currentIndex: number;
  trunk: string;
  /** Where the ordering came from; 'none' means a single, unstacked PR. */
  source: 'native' | 'graphite-comment' | 'none';
}

/** GitHub's eight reactions, in the order its reaction picker offers them. */
export const REACTION_CONTENTS = ['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'HOORAY', 'CONFUSED', 'HEART', 'ROCKET', 'EYES'] as const;

export type ReactionContent = (typeof REACTION_CONTENTS)[number];

/** One of the reactions a comment has: how many gave it, and whether the viewer is one of them. */
export interface Reaction {
  content: ReactionContent;
  count: number;
  viewerHasReacted: boolean;
}

/** A comment the viewer can react to. */
interface Reactable {
  /** GitHub's node id for it (`IC_…`, `PRR_…`, `PRRC_…`), which a reaction names; null where GitHub's page offers no way to react. */
  subjectId: string | null;
  /** Only the reactions someone gave, in GitHub's order. */
  reactions: Reaction[];
}

interface ReviewThreadComment extends Reactable {
  id: string;
  author: UserRef;
  bodyHtml: string;
  createdAt: string;
  url: string;
}

export interface ReviewThread {
  id: string;
  path: string;
  /** Line in the new file (RIGHT) or old file (LEFT); null when outdated beyond the current diff. */
  line: number | null;
  startLine: number | null;
  side: 'LEFT' | 'RIGHT';
  isResolved: boolean;
  isOutdated: boolean;
  diffHunk: string;
  comments: ReviewThreadComment[];
}

export type TimelineItem =
  | ({ kind: 'comment'; id: string; author: UserRef; bodyHtml: string; createdAt: string; url: string } & Reactable)
  | ({
      kind: 'review';
      id: string;
      author: UserRef;
      state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
      bodyHtml: string;
      createdAt: string;
      url: string;
      /** Thread ids opened by this review, so the UI can link review → threads. */
      threadIds: string[];
    } & Reactable)
  | { kind: 'commit'; id: string; oid: string; abbreviatedOid: string; messageHeadline: string; author: UserRef | null; committedAt: string; url: string }
  | { kind: 'force-push'; id: string; actor: UserRef | null; createdAt: string; beforeOid: string; afterOid: string }
  | { kind: 'review-requested'; id: string; actor: UserRef | null; requested: string; createdAt: string }
  | { kind: 'ready-for-review' | 'converted-to-draft' | 'merged' | 'closed' | 'reopened'; id: string; actor: UserRef | null; createdAt: string };

export interface ChangedFile {
  path: string;
  previousPath: string | null;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed';
  additions: number;
  deletions: number;
  /** Unified diff hunks for this file, rebuilt from GitHub's diff lines; null for binary / too large. */
  patch: string | null;
  viewerViewedState: 'VIEWED' | 'UNVIEWED' | 'DISMISSED';
  blobUrl: string;
}

export interface PrDetail extends PrSummary {
  bodyHtml: string;
  /** The description's reactions; a reaction names the description by the PR's own id. */
  descriptionReactions: Reaction[];
  headOid: string;
  baseOid: string;
  assignees: UserRef[];
  viewerCanUpdate: boolean;
  viewerDidAuthor: boolean;
  timeline: TimelineItem[];
  threads: ReviewThread[];
  files: ChangedFile[];
  stack: Stack;
  defaultMergeMethod: 'MERGE' | 'SQUASH' | 'REBASE';
  allowedMergeMethods: Array<'MERGE' | 'SQUASH' | 'REBASE'>;
  viewerCanMerge: boolean;
  viewerCanEnableAutoMerge: boolean;
  /** Required checks only, derived from `isRequired`; empty when the repo has no required checks. */
  requiredCheckNames: string[];
  unresolvedThreadCount: number;
}

/** A changed file as GitHub lists it, before its diff arrives. */
export type ChangedFileSummary = Omit<ChangedFile, 'patch' | 'previousPath'>;

/** What a changed file's diff adds to its summary: the patch, and the path it had before a rename or copy. */
export type ChangedFileDiff = Pick<ChangedFile, 'patch' | 'previousPath'>;

/**
 * The PR page, stage by stage: each is loaded on its own (`pr.fetch<Stage>`, src/lib/github-web/pr-stages.ts) and
 * rendered as soon as it arrives. Together they make a PrDetail.
 */
export interface PrStages {
  /** The PR page's HTML with its file and line counts: everything the header and the description need. */
  header: Pick<
    PrDetail,
    | 'id'
    | 'repo'
    | 'number'
    | 'title'
    | 'url'
    | 'author'
    | 'state'
    | 'isDraft'
    | 'createdAt'
    | 'updatedAt'
    | 'mergedAt'
    | 'headRefName'
    | 'baseRefName'
    | 'additions'
    | 'deletions'
    | 'changedFiles'
    | 'commentCount'
    | 'nativeStack'
    | 'bodyHtml'
    | 'descriptionReactions'
    | 'headOid'
    | 'viewerCanUpdate'
    | 'viewerDidAuthor'
  > & {
    viewerLogin: string;
    /** Where the page shows a stack coming from (GitHub's own, or Graphite's comment); the `stack` stage has the final word. */
    stackSource: Stack['source'];
  };
  activity: Pick<PrDetail, 'timeline'>;
  /** Every changed file, and the diffs GitHub sent along with the list; the others come a batch at a time (`pr.fetchFileDiffs`). */
  files: { baseOid: string; files: ChangedFileSummary[]; diffs: Record<string, ChangedFileDiff> };
  threads: Pick<PrDetail, 'threads' | 'unresolvedThreadCount'>;
  mergeBox: Pick<
    PrDetail,
    'mergeStatus' | 'reviewers' | 'reviewDecision' | 'viewerCanMerge' | 'viewerCanEnableAutoMerge' | 'allowedMergeMethods' | 'defaultMergeMethod' | 'autoMerge' | 'isInMergeQueue'
  >;
  checks: Pick<PrDetail, 'ci' | 'requiredCheckNames'> & {
    /** Why the checks list is empty when it is (GitHub answered 404, or sent no rows): the card shows it, so an empty card is never a mystery. */
    emptyReason: string | null;
  };
  stack: Pick<PrDetail, 'stack'>;
  meta: Pick<PrDetail, 'labels' | 'assignees'>;
}

export type PrStage = keyof PrStages;

export interface View {
  id: string;
  name: string;
  /**
   * GitHub search query, e.g. "is:open is:pr review-requested:@me". `@me` is allowed. With a `filter`, compiled from it
   * and `repos` whenever the view is saved.
   */
  query: string;
  /** Graphite's form of the section's filter, edited row by row; absent for a hand-written query. */
  filter?: GraphiteFilter;
  /** The repositories the view searches instead of the inbox's (absent or empty: the inbox's). */
  repos?: RepoRef[];
  limit?: number;
  collapsed?: boolean;
}

export interface ViewResult {
  view: View;
  prs: PrSummary[];
  totalCount: number;
  fetchedAt: string;
  /**
   * Why the section has no rows: GitHub would not run its search (in GitHub's words, such as "The search query contains
   * invalid syntax.") or the request failed. `query` is what GitHub was asked: the search, scope and all, or
   * `inbox:<filter>` for one of GitHub's own sections.
   */
  error?: { message: string; query: string };
}
